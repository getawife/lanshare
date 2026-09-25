package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const discovery_port = 43821

type event struct {
	type_ string `json:"type"`
	data  any    `json:"data"`
}

type share_record struct {
	token      string
	path       string
	expires_at time.Time
	password   string
}

type server_state struct {
	device_id               string
	device_name             string
	version                 string
	http_port               int
	lan_port                int
	udp_discovery_bound     bool
	user_data_dir           string
	peers                   map[string]device
	events                  map[chan event]struct{}
	mu                      sync.Mutex
	shares                  map[string]share_record
	warnings                []string
	settings                backend_settings
	admin_token             string
	pending_transfers       map[string]chan transfer_decision
	allowed_transfer_tokens map[string]allowed_token
	trusted_ids             map[string]struct{}
}

type transfer_decision struct {
	accepted bool
	token    string
}

type allowed_token struct {
	transfer_id string
	expires_at  time.Time
}

func new_server_state(identity device_identity, user_data_dir string, trusted_ids map[string]struct{}) (*server_state, error) {
	name := "LANShare Desktop"
	if h, err := os.Hostname(); err == nil && h != "" {
		name = h
	}
	if trusted_ids == nil {
		trusted_ids = map[string]struct{}{}
	}
	return &server_state{
		device_id:           identity.DeviceID,
		device_name:         name,
		version:             "1.0.4",
		udp_discovery_bound: false,
		user_data_dir:       user_data_dir,
		peers:               map[string]device{},
		events:              map[chan event]struct{}{},
		shares:              map[string]share_record{},
		warnings:            nil,
		settings: backend_settings{
			ask_before_accepting: true,
			auto_accept_trusted:  false,
			download_folder:      "",
		},
		pending_transfers:       map[string]chan transfer_decision{},
		allowed_transfer_tokens: map[string]allowed_token{},
		trusted_ids:             trusted_ids,
	}, nil
}

func (s *server_state) update_settings(cfg backend_settings) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if name := strings.TrimSpace(cfg.device_name); name != "" {
		s.device_name = name
	}
	s.settings = cfg
}

func (s *server_state) get_settings() backend_settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

func (s *server_state) set_trusted(peer_id string, trusted bool) error {
	if peer_id == "" {
		return fmt.Errorf("peer id required")
	}

	s.mu.Lock()
	if trusted {
		s.trusted_ids[peer_id] = struct{}{}
	} else {
		delete(s.trusted_ids, peer_id)
	}
	snapshot := make(map[string]struct{}, len(s.trusted_ids))
	for id := range s.trusted_ids {
		snapshot[id] = struct{}{}
	}

	var updated *device
	if peer, ok := s.peers[peer_id]; ok {
		peer.trusted = trusted
		s.peers[peer_id] = peer
		copied := peer
		updated = &copied
	}
	user_data_dir := s.user_data_dir
	s.mu.Unlock()

	if err := save_trusted_ids(user_data_dir, snapshot); err != nil {
		return err
	}

	if updated != nil {
		s.publish(event{type_: "peer", data: *updated})
	}
	return nil
}

func (s *server_state) list_trusted() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.trusted_ids))
	for id := range s.trusted_ids {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func (s *server_state) add_warning(w string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.warnings {
		if existing == w {
			return
		}
	}
	s.warnings = append(s.warnings, w)
}

func (s *server_state) get_diagnostics() network_diagnostics {
	s.mu.Lock()
	defer s.mu.Unlock()

	var active_ifaces []string
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range ifaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, addr := range addrs {
				ip_net, ok := addr.(*net.IPNet)
				if ok && ip_net.IP.To4() != nil {
					active_ifaces = append(active_ifaces, fmt.Sprintf("%s (%s)", iface.Name, ip_net.IP.String()))
				}
			}
		}
	}

	var all_warnings []string
	if len(active_ifaces) == 0 {
		all_warnings = append(all_warnings, "No active local network interface found. Ensure Wi-Fi or Ethernet is connected.")
	}
	if s.lan_port > 0 && s.lan_port != discovery_port {
		all_warnings = append(all_warnings, fmt.Sprintf("Default UDP discovery port %d was occupied; using port %d. Peer discovery may be limited.", discovery_port, s.lan_port))
	}
	for _, w := range s.warnings {
		all_warnings = append(all_warnings, w)
	}

	return network_diagnostics{
		has_active_lan:      len(active_ifaces) > 0,
		interfaces:          active_ifaces,
		udp_discovery_bound: s.udp_discovery_bound,
		udp_port:            s.lan_port,
		warnings:            all_warnings,
	}
}

func (s *server_state) snapshot() app_state {
	s.mu.Lock()
	peers := make([]device, 0, len(s.peers))
	for _, p := range s.peers {
		peers = append(peers, p)
	}
	s.mu.Unlock()

	return app_state{
		device:      s.self_device(),
		port:        s.lan_port,
		http_port:   s.http_port,
		peers:       peers,
		diagnostics: s.get_diagnostics(),
	}
}

func (s *server_state) self_device() device {
	return device{
		id:            s.device_id,
		name:          s.device_name,
		os:            format_os_name(runtime.GOOS),
		type_:         device_type(runtime.GOOS),
		ip:            "127.0.0.1",
		port:          s.lan_port,
		http_port:     s.http_port,
		status:        "available",
		trusted:       true,
		protocol:      1,
		version:       s.version,
		capabilities:  []string{"files", "clipboard", "web"},
		last_seen:     time.Now(),
		device_hash:   s.device_id,
		settings:      s.settings,
	}
}

func (s *server_state) peers_snapshot() []device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]device, 0, len(s.peers))
	for _, p := range s.peers {
		out = append(out, p)
	}
	return out
}

func (s *server_state) subscribe() chan event {
	ch := make(chan event, 16)
	s.mu.Lock()
	s.events[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func (s *server_state) unsubscribe(ch chan event) {
	s.mu.Lock()
	delete(s.events, ch)
	close(ch)
	s.mu.Unlock()
}

func (s *server_state) publish(evt event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.events {
		select {
		case ch <- evt:
		default:
		}
	}
}

func (s *server_state) run_discovery(ctx context.Context, conn net.PacketConn) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		payload, _ := json.Marshal(map[string]any{
			"id":           s.device_id,
			"name":         s.device_name,
			"os":           runtime.GOOS,
			"type":         device_type(runtime.GOOS),
			"version":      s.version,
			"port":         s.lan_port,
			"httpPort":     s.http_port,
			"protocol":     1,
			"capabilities": []string{"files", "clipboard", "web"},
			"settings": map[string]any{
				"askBeforeAccepting": s.settings.ask_before_accepting,
				"autoAcceptTrusted":  s.settings.auto_accept_trusted,
			},
		})

		for _, pair := range get_interface_broadcast_pairs(discovery_port) {
			if pair.local == nil || pair.bcast == nil {
				continue
			}
			func() {
				laddr := &net.UDPAddr{IP: pair.local.IP, Port: 0}
				raddr := &net.UDPAddr{IP: pair.bcast.IP, Port: pair.bcast.Port}
				conn, err := net.DialUDP("udp4", laddr, raddr)
				if err != nil {
					err_str := strings.ToLower(err.Error())
					if strings.Contains(err_str, "permission") || strings.Contains(err_str, "access") || strings.Contains(err_str, "firewall") {
						s.add_warning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					}
					return
				}
				defer conn.Close()
				_ = conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
				if _, err := conn.Write(payload); err != nil {
					err_str := strings.ToLower(err.Error())
					if strings.Contains(err_str, "permission") || strings.Contains(err_str, "access") || strings.Contains(err_str, "firewall") {
						s.add_warning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					} else if strings.Contains(err_str, "unreachable") || strings.Contains(err_str, "network is down") {
						s.add_warning("Local network is unreachable. Peer discovery is restricted.")
					}
				}
			}()
		}

		for _, bcast := range get_broadcast_addresses(discovery_port) {
			if bcast.IP.Equal(net.IPv4bcast) {
				if _, err := conn.WriteTo(payload, bcast); err != nil {
					err_str := strings.ToLower(err.Error())
					if strings.Contains(err_str, "permission") || strings.Contains(err_str, "access") || strings.Contains(err_str, "firewall") {
						s.add_warning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					} else if strings.Contains(err_str, "unreachable") || strings.Contains(err_str, "network is down") {
						s.add_warning("Local network is unreachable. Peer discovery is restricted.")
					}
				}
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type interface_broadcast_pair struct {
	local *net.UDPAddr
	bcast *net.UDPAddr
}

func get_interface_broadcast_pairs(port int) []interface_broadcast_pair {
	out := []interface_broadcast_pair{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip_net, ok := addr.(*net.IPNet)
			if !ok || ip_net.IP.To4() == nil {
				continue
			}
			ip := ip_net.IP.To4()
			mask := ip_net.Mask
			if len(mask) != 4 {
				continue
			}
			bcast_ip := net.IP(make([]byte, 4))
			for i := 0; i < 4; i++ {
				bcast_ip[i] = ip[i] | ^mask[i]
			}
			out = append(out, interface_broadcast_pair{
				local: &net.UDPAddr{IP: ip, Port: 0},
				bcast: &net.UDPAddr{IP: bcast_ip, Port: port},
			})
		}
	}
	return out
}

func (s *server_state) run_discovery_listener(ctx context.Context, conn net.PacketConn) error {
	buf := make([]byte, 4096)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				if ctx.Err() != nil {
					return nil
				}
				continue
			}
			return err
		}
		var packet map[string]any
		if json.Unmarshal(buf[:n], &packet) != nil {
			continue
		}
		id, _ := packet["id"].(string)
		name, _ := packet["name"].(string)

		name = strings.TrimSpace(name)
		name = strings.Trim(name, "\x00")

		ip := strings.Split(addr.String(), ":")[0]
		port := int_from(packet["port"])
		http_port := int_from(packet["httpPort"])
		if http_port == 0 {
			http_port = port
		}

		if id == "" || id == s.device_id {
			continue
		}
		if name == "" {
			name = "Nearby device"
		}

		var peer_settings backend_settings
		if raw_settings, ok := packet["settings"]; ok {
			if b, err := json.Marshal(raw_settings); err == nil {
				_ = json.Unmarshal(b, &peer_settings)
			}
		}

		s.mu.Lock()
		_, is_trusted := s.trusted_ids[id]
		s.mu.Unlock()

		peer := device{
			id:            id,
			name:          name,
			os:            format_os_name(string_from(packet["os"])),
			type_:         device_type(string_from(packet["os"])),
			ip:            ip,
			port:          port,
			http_port:     http_port,
			status:        "available",
			trusted:       is_trusted,
			protocol:      int_from(packet["protocol"]),
			version:       string_from(packet["version"]),
			capabilities:  string_slice(packet["capabilities"]),
			last_seen:     time.Now(),
			settings:      peer_settings,
		}

		s.mu.Lock()
		s.peers[id] = peer
		s.mu.Unlock()
		s.publish(event{type_: "peer", data: peer})
	}
}

func (s *server_state) run_expired_peer_sweep(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			var expired []device
			for key, peer := range s.peers {
				if peer.status != "offline" && time.Since(peer.last_seen) > 12*time.Second {
					peer.status = "offline"
					s.peers[key] = peer
					expired = append(expired, peer)
				}
			}
			s.mu.Unlock()
			for _, p := range expired {
				s.publish(event{type_: "peer", data: p})
			}
		}
	}
}

func (s *server_state) run_loopback_peer_probe(ctx context.Context) {
	v := os.Getenv("LANSHARE_LOOPBACK_PEER_HTTP_PORT")
	if v == "" {
		return
	}
	peer_port, err := strconv.Atoi(v)
	if err != nil || peer_port <= 0 {
		return
	}
	target_id := fmt.Sprintf("loopback-%d", peer_port)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		peer, ok := probe_loopback_peer(peer_port, target_id)
		s.mu.Lock()
		if ok {
			s.peers[target_id] = peer
		} else {
			delete(s.peers, target_id)
		}
		s.mu.Unlock()
		if ok {
			s.publish(event{type_: "peer", data: peer})
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func probe_loopback_peer(port int, id string) (device, bool) {
	url := fmt.Sprintf("http://127.0.0.1:%d/api/health", port)
	client := &http.Client{Timeout: 750 * time.Millisecond}
	resp, err := client.Get(url)
	if err != nil {
		return device{}, false
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 300 {
		return device{}, false
	}
	return device{
		id:            id,
		name:          fmt.Sprintf("Local Test Peer %d", port),
		os:            format_os_name(runtime.GOOS),
		type_:         device_type(runtime.GOOS),
		ip:            "127.0.0.1",
		port:          port,
		http_port:     port,
		status:        "available",
		trusted:       true,
		protocol:      1,
		version:       "local-test",
		capabilities:  []string{"files", "clipboard", "web"},
		last_seen:     time.Now(),
		settings:      backend_settings{ask_before_accepting: true, auto_accept_trusted: false, download_folder: ""},
	}, true
}

func (s *server_state) send_files(ctx context.Context, req transfer_request) error {
	peer := s.find_peer(req.peer_id)
	if peer.id == "" {
		return fmt.Errorf("peer not found")
	}
	manifest, err := s.expand_transfer_files(req.files)
	if err != nil {
		return err
	}
	if len(manifest) == 0 {
		return fmt.Errorf("no transferable files found")
	}

	target_port := peer.http_port
	if target_port == 0 {
		target_port = peer.port
	}

	prep_url := fmt.Sprintf("http://%s:%d/api/prepare-transfer", peer.ip, target_port)
	prep_payload, err := json.Marshal(map[string]any{
		"transferId": req.transfer_id,
		"peerId":     s.device_id,
		"deviceName": s.device_name,
		"files":      manifest_to_meta(manifest),
	})
	if err != nil {
		return fmt.Errorf("failed to encode prepare transfer payload: %w", err)
	}

	prep_req, err := http.NewRequestWithContext(ctx, http.MethodPost, prep_url, strings.NewReader(string(prep_payload)))
	if err != nil {
		return fmt.Errorf("failed to create prepare transfer request: %w", err)
	}
	prep_req.Header.Set("Content-Type", "application/json")

	prep_client := &http.Client{Timeout: 35 * time.Second}
	prep_resp, err := prep_client.Do(prep_req)
	if err != nil {
		return fmt.Errorf("failed to contact peer: %w", err)
	}
	defer prep_resp.Body.Close()

	if prep_resp.StatusCode >= 300 {
		var err_data struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.NewDecoder(prep_resp.Body).Decode(&err_data) == nil && err_data.Message != "" {
			return fmt.Errorf("peer rejected transfer: %s (%s)", err_data.Message, err_data.Code)
		}
		return fmt.Errorf("peer rejected transfer with status %s", prep_resp.Status)
	}

	var prep_result struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(prep_resp.Body).Decode(&prep_result); err != nil || !prep_result.OK || prep_result.Token == "" {
		return fmt.Errorf("invalid response from peer prepare endpoint")
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	receive_url := fmt.Sprintf("http://%s:%d/api/receive", peer.ip, target_port)
	http_req, err := http.NewRequestWithContext(ctx, http.MethodPost, receive_url, pr)
	if err != nil {
		return err
	}
	http_req.Header.Set("Content-Type", mw.FormDataContentType())
	http_req.Header.Set("X-Lanshare-Transfer-Token", prep_result.Token)

	progress_path := func(done int64, total int64) {
		s.publish(event{type_: "transfer", data: map[string]any{
			"id":               req.transfer_id,
			"peerId":           req.peer_id,
			"deviceName":       peer.name,
			"state":            "transferring",
			"direction":        "outgoing",
			"files":            req.files,
			"bytesTransferred": done,
			"totalSizeBytes":   total,
		}})
	}
	go func() {
		defer pw.Close()
		defer mw.Close()
		if err := s.write_transfer_multipart(mw, req.transfer_id, manifest, progress_path); err != nil {
			_ = pw.CloseWithError(err)
		}
	}()
	resp, err := http.DefaultClient.Do(http_req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var err_data struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.NewDecoder(resp.Body).Decode(&err_data) == nil && err_data.Message != "" {
			return fmt.Errorf("peer rejected upload: %s (%s)", err_data.Message, err_data.Code)
		}
		return fmt.Errorf("peer rejected transfer: %s", resp.Status)
	}
	return nil
}

type expanded_transfer_file struct {
	source_path   string
	relative_path string
	is_directory  bool
	size_bytes    int64
	checksum      string
}

func (s *server_state) expand_transfer_files(files []file_item) ([]expanded_transfer_file, error) {
	var out []expanded_transfer_file
	for _, file := range files {
		info, err := os.Stat(file.path)
		if err != nil {
			return nil, err
		}
		if info.IsDir() || file.is_dir {
			root := file.path
			base := filepath.Base(root)
			out = append(out, expanded_transfer_file{
				source_path:   root,
				relative_path: base,
				is_directory:  true,
			})
			err = filepath.WalkDir(root, func(path string, d os.DirEntry, walk_err error) error {
				if walk_err != nil {
					return walk_err
				}
				if path == root {
					return nil
				}
				rel, err := filepath.Rel(root, path)
				if err != nil {
					return err
				}
				rel = filepath.ToSlash(filepath.Join(base, rel))
				info, err := d.Info()
				if err != nil {
					return err
				}
				if d.IsDir() {
					out = append(out, expanded_transfer_file{
						source_path:   path,
						relative_path: rel,
						is_directory:  true,
					})
					return nil
				}
				cs, _ := compute_file_sha256(path)
				out = append(out, expanded_transfer_file{
					source_path:   path,
					relative_path: rel,
					size_bytes:    info.Size(),
					checksum:      cs,
				})
				return nil
			})
			if err != nil {
				return nil, err
			}
			continue
		}
		cs, _ := compute_file_sha256(file.path)
		out = append(out, expanded_transfer_file{
			source_path:   file.path,
			relative_path: file.name,
			size_bytes:    info.Size(),
			checksum:      cs,
		})
	}
	return out, nil
}

func (s *server_state) write_transfer_multipart(mw *multipart.Writer, transfer_id string, manifest []expanded_transfer_file, progress func(int64, int64)) error {
	total := int64(0)
	for _, entry := range manifest {
		if !entry.is_directory {
			total += entry.size_bytes
		}
	}
	meta := map[string]any{
		"transferId": transfer_id,
		"peerId":     s.device_id,
		"deviceName": s.device_name,
		"files":      manifest_to_meta(manifest),
	}
	meta_part, err := mw.CreateFormField("metadata")
	if err != nil {
		return err
	}
	if err := json.NewEncoder(meta_part).Encode(meta); err != nil {
		return err
	}
	var copied int64
	for idx, entry := range manifest {
		part, err := mw.CreateFormField(fmt.Sprintf("file-%d", idx))
		if err != nil {
			return err
		}
		if entry.is_directory {
			progress(copied, total)
			continue
		}
		if err := copy_file_with_progress(part, entry.source_path, func(n int64) {
			copied += n
			progress(copied, total)
		}); err != nil {
			return err
		}
	}
	return nil
}

func manifest_to_meta(manifest []expanded_transfer_file) []map[string]any {
	out := make([]map[string]any, 0, len(manifest))
	for _, entry := range manifest {
		out = append(out, map[string]any{
			"relativePath": entry.relative_path,
			"isDir":        entry.is_directory,
			"size":         entry.size_bytes,
			"checksum":     entry.checksum,
		})
	}
	return out
}

func copy_file_with_progress(dst io.Writer, source_path string, on_chunk func(int64)) error {
	src, err := os.Open(source_path)
	if err != nil {
		return err
	}
	defer src.Close()
	buf := make([]byte, 32*1024)
	for {
		n, read_err := src.Read(buf)
		if n > 0 {
			if _, err := dst.Write(buf[:n]); err != nil {
				return err
			}
			on_chunk(int64(n))
		}
		if errors.Is(read_err, io.EOF) {
			return nil
		}
		if read_err != nil {
			return read_err
		}
	}
}

func (s *server_state) find_peer(id string) device {
	s.mu.Lock()
	defer s.mu.Unlock()
	if peer, ok := s.peers[id]; ok {
		return peer
	}
	return device{}
}

func (s *server_state) create_share(req share_request) (map[string]any, error) {
	if len(req.files) == 0 {
		return nil, fmt.Errorf("no files selected")
	}
	token := random_token(16)
	expires := time.Now().Add(10 * time.Minute)
	if req.expires_in > 0 {
		expires = time.Now().Add(time.Duration(req.expires_in) * time.Second)
	}
	path := req.files[0]
	s.mu.Lock()
	s.shares[token] = share_record{token: token, path: path, expires_at: expires, password: req.password}
	s.mu.Unlock()
	return map[string]any{
		"url":       fmt.Sprintf("http://127.0.0.1:%d/s/%s", s.http_port, token),
		"token":     token,
		"expiresAt": expires,
	}, nil
}

func (s *server_state) serve_share(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/s/"), "/")
	token := parts[0]
	s.mu.Lock()
	share, ok := s.shares[token]
	s.mu.Unlock()
	if !ok || time.Now().After(share.expires_at) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		if info, err := os.Stat(share.path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, share.path)
			return
		}
		http.Error(w, "share path unavailable", http.StatusNotFound)
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func device_type(os_name string) string {
	switch strings.ToLower(os_name) {
	case "darwin", "macos":
		return "mac"
	case "windows", "linux":
		return "pc"
	default:
		return "phone"
	}
}

func format_os_name(os_name string) string {
	switch strings.ToLower(os_name) {
	case "darwin":
		return "macOS"
	case "windows":
		return "Windows"
	case "linux":
		return "Linux"
	case "android":
		return "Android"
	case "ios":
		return "iOS"
	default:
		return os_name
	}
}

func get_broadcast_addresses(port int) []*net.UDPAddr {
	addrs := []*net.UDPAddr{
		{IP: net.IPv4bcast, Port: port},
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return addrs
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		unicast_addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range unicast_addrs {
			ip_net, ok := addr.(*net.IPNet)
			if !ok || ip_net.IP.To4() == nil {
				continue
			}
			ip := ip_net.IP.To4()
			mask := ip_net.Mask
			if len(mask) == 4 {
				bcast_ip := net.IP(make([]byte, 4))
				for i := 0; i < 4; i++ {
					bcast_ip[i] = ip[i] | ^mask[i]
				}
				addrs = append(addrs, &net.UDPAddr{IP: bcast_ip, Port: port})
			}
		}
	}
	return addrs
}

func compute_file_sha256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func int_from(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}

func string_from(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func string_slice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}