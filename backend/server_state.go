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
	"strings"
	"sync"
	"time"
	"strconv"
)

const discoveryPort = 43821

type event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type shareRecord struct {
	Token     string
	Path      string
	ExpiresAt time.Time
	Password  string
}

type ServerState struct {
	DeviceID          string
	DeviceName        string
	Version           string
	HTTPPort          int
	LANPort           int
	UDPDiscoveryBound bool
	Peers             map[string]Device // Keyed by Name (lowercased) to guarantee zero duplicate cards
	events            map[chan event]struct{}
	mu                sync.Mutex
	shares            map[string]shareRecord
	warnings          []string
	settings          BackendSettings
	// AdminToken is an optional per-run secret used to authenticate privileged
	// local requests from the Electron host (X-Lanshare-Token header).
	AdminToken        string
	// pendingTransfers holds channels that wait for local user acceptance for
	// a transfer. Keyed by transferID.
	pendingTransfers  map[string]chan transferDecision
	// allowedTransferTokens maps transfer tokens to the transfer ID and expiry.
	allowedTransferTokens map[string]allowedToken
}

type transferDecision struct {
	Accepted bool
	Token    string
}

type allowedToken struct {
	TransferID string
	ExpiresAt  time.Time
}

func NewServerState() (*ServerState, error) {
	name := "LANShare Desktop"
	if h, err := os.Hostname(); err == nil && h != "" {
		name = h
	}
	return &ServerState{
		DeviceID:          randomToken(8), // Unique ID per running process instance
		DeviceName:        name,
		Version:           "1.0.0",
		UDPDiscoveryBound: false,
		Peers:             map[string]Device{},
		events:            map[chan event]struct{}{},
		shares:            map[string]shareRecord{},
		warnings:          nil,
		settings: BackendSettings{
			AskBeforeAccepting: true,
			AutoAcceptTrusted:  false,
			DownloadFolder:     "",
		},
		pendingTransfers:     map[string]chan transferDecision{},
		allowedTransferTokens: map[string]allowedToken{},
	}, nil
}

func (s *ServerState) UpdateSettings(cfg BackendSettings) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if name := strings.TrimSpace(cfg.DeviceName); name != "" {
		s.DeviceName = name
	}
	s.settings = cfg
}

func (s *ServerState) GetSettings() BackendSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

func (s *ServerState) AddWarning(w string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.warnings {
		if existing == w {
			return
		}
	}
	s.warnings = append(s.warnings, w)
}

func (s *ServerState) GetDiagnostics() NetworkDiagnostics {
	s.mu.Lock()
	defer s.mu.Unlock()

	var activeIfaces []string
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
				ipNet, ok := addr.(*net.IPNet)
				if ok && ipNet.IP.To4() != nil {
					activeIfaces = append(activeIfaces, fmt.Sprintf("%s (%s)", iface.Name, ipNet.IP.String()))
				}
			}
		}
	}

	var allWarnings []string
	if len(activeIfaces) == 0 {
		allWarnings = append(allWarnings, "No active local network interface found. Ensure Wi-Fi or Ethernet is connected.")
	}
	if s.LANPort > 0 && s.LANPort != discoveryPort {
		allWarnings = append(allWarnings, fmt.Sprintf("Default UDP discovery port %d was occupied; using port %d. Peer discovery may be limited.", discoveryPort, s.LANPort))
	}
	for _, w := range s.warnings {
		allWarnings = append(allWarnings, w)
	}

	return NetworkDiagnostics{
		HasActiveLAN:      len(activeIfaces) > 0,
		Interfaces:        activeIfaces,
		UDPDiscoveryBound: s.UDPDiscoveryBound,
		UDPPort:           s.LANPort,
		Warnings:          allWarnings,
	}
}

func (s *ServerState) Snapshot() AppState {
	s.mu.Lock()
	peers := make([]Device, 0, len(s.Peers))
	for _, p := range s.Peers {
		peers = append(peers, p)
	}
	s.mu.Unlock()

	return AppState{
		Device:      s.selfDevice(),
		Port:        s.LANPort,
		HTTPPort:    s.HTTPPort,
		Peers:       peers,
		Diagnostics: s.GetDiagnostics(),
	}
}

func (s *ServerState) selfDevice() Device {
	return Device{
		ID:           s.DeviceID,
		Name:         s.DeviceName,
		OS:           formatOSName(runtime.GOOS),
		Type:         deviceType(runtime.GOOS),
		IP:           "127.0.0.1",
		Port:         s.LANPort,
		HTTPPort:     s.HTTPPort,
		Status:       "available",
		Trusted:      true,
		Protocol:     1,
		Version:      s.Version,
		Capabilities: []string{"files", "clipboard", "web"},
		LastSeen:     time.Now(),
		DeviceHash:   s.DeviceID,
		Settings:     s.settings,
	}
}

func (s *ServerState) PeersSnapshot() []Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Device, 0, len(s.Peers))
	for _, p := range s.Peers {
		out = append(out, p)
	}
	return out
}

func (s *ServerState) Subscribe() chan event {
	ch := make(chan event, 16)
	s.mu.Lock()
	s.events[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func (s *ServerState) Unsubscribe(ch chan event) {
	s.mu.Lock()
	delete(s.events, ch)
	close(ch)
	s.mu.Unlock()
}

func (s *ServerState) publish(evt event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.events {
		select {
		case ch <- evt:
		default:
		}
	}
}

func (s *ServerState) RunDiscovery(ctx context.Context, conn net.PacketConn) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		payload, _ := json.Marshal(map[string]any{
			"id":           s.DeviceID,
			"name":         s.DeviceName,
			"os":           runtime.GOOS,
			"type":         deviceType(runtime.GOOS),
			"version":      s.Version,
			"port":         s.LANPort,
			"httpPort":     s.HTTPPort,
			"protocol":     1,
			"capabilities": []string{"files", "clipboard", "web"},
			"settings":     s.settings,
		})

		// 1) Send using per-interface sockets to their calculated broadcast addresses.
		for _, pair := range getInterfaceBroadcastPairs(discoveryPort) {
			if pair.Local == nil || pair.Bcast == nil {
				continue
			}
			// Try to bind a UDP socket to the interface local IP and write to its
			// broadcast address. This ensures the packet is emitted on that
			// interface rather than only the system default.
			func() {
				laddr := &net.UDPAddr{IP: pair.Local.IP, Port: 0}
				raddr := &net.UDPAddr{IP: pair.Bcast.IP, Port: pair.Bcast.Port}
				conn, err := net.DialUDP("udp4", laddr, raddr)
				if err != nil {
					// best-effort: record a warning and continue
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "permission") || strings.Contains(errStr, "access") || strings.Contains(errStr, "firewall") {
						s.AddWarning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					}
					return
				}
				defer conn.Close()
				_ = conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
				if _, err := conn.Write(payload); err != nil {
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "permission") || strings.Contains(errStr, "access") || strings.Contains(errStr, "firewall") {
						s.AddWarning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					} else if strings.Contains(errStr, "unreachable") || strings.Contains(errStr, "network is down") {
						s.AddWarning("Local network is unreachable. Peer discovery is restricted.")
					}
				}
			}()
		}

		// 2) Fallback: send to global IPv4 broadcast using the provided conn.
		for _, bcast := range getBroadcastAddresses(discoveryPort) {
			if bcast.IP.Equal(net.IPv4bcast) {
				if _, err := conn.WriteTo(payload, bcast); err != nil {
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "permission") || strings.Contains(errStr, "access") || strings.Contains(errStr, "firewall") {
						s.AddWarning("Firewall or security software may be blocking UDP broadcast discovery packets.")
					} else if strings.Contains(errStr, "unreachable") || strings.Contains(errStr, "network is down") {
						s.AddWarning("Local network is unreachable. Peer discovery is restricted.")
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

// interfaceBroadcastPair ties a local interface unicast address to its
// calculated broadcast address (for IPv4 only).
type interfaceBroadcastPair struct {
	Local *net.UDPAddr
	Bcast *net.UDPAddr
}

// getInterfaceBroadcastPairs returns local IP / broadcast pairs for each
// active non-loopback IPv4 interface.
func getInterfaceBroadcastPairs(port int) []interfaceBroadcastPair {
	out := []interfaceBroadcastPair{}
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
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}
			ip := ipNet.IP.To4()
			mask := ipNet.Mask
			if len(mask) != 4 {
				continue
			}
			bcastIP := net.IP(make([]byte, 4))
			for i := 0; i < 4; i++ {
				bcastIP[i] = ip[i] | ^mask[i]
			}
			out = append(out, interfaceBroadcastPair{
				Local: &net.UDPAddr{IP: ip, Port: 0},
				Bcast: &net.UDPAddr{IP: bcastIP, Port: port},
			})
		}
	}
	return out
}

func (s *ServerState) RunDiscoveryListener(ctx context.Context, conn net.PacketConn) error {
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

		// --- BULLETPROOF FIX: Trim spaces, newlines, and most importantly NULL bytes ---
		name = strings.TrimSpace(name)
		name = strings.Trim(name, "\x00")
		// ------------------------------------------------------------------------------

		ip := strings.Split(addr.String(), ":")[0]
		port := intFrom(packet["port"])
		httpPort := intFrom(packet["httpPort"])
		if httpPort == 0 {
			httpPort = port
		}

		// Filter out invalid, empty, or self packets
		if name == "" || strings.EqualFold(name, s.DeviceName) || id == s.DeviceID {
			continue
		}

		// Parse optional settings object if present in discovery packet.
		var peerSettings BackendSettings
		if rawSettings, ok := packet["settings"]; ok {
			if b, err := json.Marshal(rawSettings); err == nil {
				_ = json.Unmarshal(b, &peerSettings)
			}
		}
		peer := Device{
			ID:           id,
			Name:         name,
			OS:           formatOSName(stringFrom(packet["os"])),
			Type:         deviceType(stringFrom(packet["os"])),
			IP:           ip,
			Port:         port,
			HTTPPort:     httpPort,
			Status:       "available",
			Trusted:      false,
			Protocol:     intFrom(packet["protocol"]),
			Version:      stringFrom(packet["version"]),
			Capabilities: stringSlice(packet["capabilities"]),
			LastSeen:     time.Now(),
			Settings:     peerSettings,
		}

		// Use lowercased name as map key to force exact 1 entry per physical device name
		key := strings.ToLower(name)

		s.mu.Lock()
		s.Peers[key] = peer
		s.mu.Unlock()
		s.publish(event{Type: "peer", Data: peer})

	}
}

func (s *ServerState) RunExpiredPeerSweep(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			var expired []Device
			for key, peer := range s.Peers {
				if peer.Status != "offline" && time.Since(peer.LastSeen) > 12*time.Second {
					peer.Status = "offline"
					s.Peers[key] = peer
					expired = append(expired, peer)
				}
			}
			s.mu.Unlock()
			for _, p := range expired {
				s.publish(event{Type: "peer", Data: p})
			}
		}
	}
}

func (s *ServerState) RunLoopbackPeerProbe(ctx context.Context) {
	v := os.Getenv("LANSHARE_LOOPBACK_PEER_HTTP_PORT")
	if v == "" {
		return
	}
	peerPort, err := strconv.Atoi(v)
	if err != nil || peerPort <= 0 {
		return
	}
	targetID := fmt.Sprintf("loopback-%d", peerPort)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		peer, ok := probeLoopbackPeer(peerPort, targetID)
		s.mu.Lock()
		if ok {
			s.Peers[targetID] = peer
		} else {
			delete(s.Peers, targetID)
		}
		s.mu.Unlock()
		if ok {
			s.publish(event{Type: "peer", Data: peer})
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func probeLoopbackPeer(port int, id string) (Device, bool) {
	url := fmt.Sprintf("http://127.0.0.1:%d/api/health", port)
	client := &http.Client{Timeout: 750 * time.Millisecond}
	resp, err := client.Get(url)
	if err != nil {
		return Device{}, false
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 300 {
		return Device{}, false
	}
	return Device{
		ID:           id,
		Name:         fmt.Sprintf("Local Test Peer %d", port),
		OS:           formatOSName(runtime.GOOS),
		Type:         deviceType(runtime.GOOS),
		IP:           "127.0.0.1",
		Port:         port,
		HTTPPort:     port,
		Status:       "available",
		Trusted:      true,
		Protocol:     1,
		Version:      "local-test",
		Capabilities: []string{"files", "clipboard", "web"},
		LastSeen:     time.Now(),
		Settings:     BackendSettings{AskBeforeAccepting: true, AutoAcceptTrusted: false, DownloadFolder: ""},
	}, true
}

func (s *ServerState) SendFiles(ctx context.Context, req TransferRequest) error {
	peer := s.findPeer(req.PeerID)
	if peer.ID == "" {
		return fmt.Errorf("peer not found")
	}
	manifest, err := s.expandTransferFiles(req.Files)
	if err != nil {
		return err
	}
	if len(manifest) == 0 {
		return fmt.Errorf("no transferable files found")
	}

	targetPort := peer.HTTPPort
	if targetPort == 0 {
		targetPort = peer.Port
	}

	// 1. Prepare Transfer Handshake with recipient
	prepURL := fmt.Sprintf("http://%s:%d/api/prepare-transfer", peer.IP, targetPort)
	prepPayload, err := json.Marshal(map[string]any{
		"transferId": req.TransferID,
		"peerId":     s.DeviceID,
		"deviceName": s.DeviceName,
		"files":      manifestToMeta(manifest),
	})
	if err != nil {
		return fmt.Errorf("failed to encode prepare transfer payload: %w", err)
	}

	prepReq, err := http.NewRequestWithContext(ctx, http.MethodPost, prepURL, strings.NewReader(string(prepPayload)))
	if err != nil {
		return fmt.Errorf("failed to create prepare transfer request: %w", err)
	}
	prepReq.Header.Set("Content-Type", "application/json")

	// Allow up to 35 seconds for recipient to respond (accounting for user prompt timeout)
	prepClient := &http.Client{Timeout: 35 * time.Second}
	prepResp, err := prepClient.Do(prepReq)
	if err != nil {
		return fmt.Errorf("failed to contact peer: %w", err)
	}
	defer prepResp.Body.Close()

	if prepResp.StatusCode >= 300 {
		var errData struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.NewDecoder(prepResp.Body).Decode(&errData) == nil && errData.Message != "" {
			return fmt.Errorf("peer rejected transfer: %s (%s)", errData.Message, errData.Code)
		}
		return fmt.Errorf("peer rejected transfer with status %s", prepResp.Status)
	}

	var prepResult struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(prepResp.Body).Decode(&prepResult); err != nil || !prepResult.OK || prepResult.Token == "" {
		return fmt.Errorf("invalid response from peer prepare endpoint")
	}

	// 2. Stream multipart file data to recipient with the obtained token
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	receiveURL := fmt.Sprintf("http://%s:%d/api/receive", peer.IP, targetPort)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, receiveURL, pr)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", mw.FormDataContentType())
	httpReq.Header.Set("X-Lanshare-Transfer-Token", prepResult.Token)

	progressPath := func(done int64, total int64) {
		s.publish(event{Type: "transfer", Data: map[string]any{
			"id":               req.TransferID,
			"peerId":           req.PeerID,
			"deviceName":       peer.Name,
			"state":            "transferring",
			"direction":        "outgoing",
			"files":            req.Files,
			"bytesTransferred": done,
			"totalSizeBytes":   total,
		}})
	}
	go func() {
		defer pw.Close()
		defer mw.Close()
		if err := s.writeTransferMultipart(mw, req.TransferID, manifest, progressPath); err != nil {
			_ = pw.CloseWithError(err)
		}
	}()
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var errData struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.NewDecoder(resp.Body).Decode(&errData) == nil && errData.Message != "" {
			return fmt.Errorf("peer rejected upload: %s (%s)", errData.Message, errData.Code)
		}
		return fmt.Errorf("peer rejected transfer: %s", resp.Status)
	}
	return nil
}

type expandedTransferFile struct {
	SourcePath   string
	RelativePath string
	IsDirectory  bool
	SizeBytes    int64
	Checksum     string
}

func (s *ServerState) expandTransferFiles(files []FileItem) ([]expandedTransferFile, error) {
	var out []expandedTransferFile
	for _, file := range files {
		info, err := os.Stat(file.Path)
		if err != nil {
			return nil, err
		}
		if info.IsDir() || file.IsDir {
			root := file.Path
			base := filepath.Base(root)
			out = append(out, expandedTransferFile{
				SourcePath:   root,
				RelativePath: base,
				IsDirectory:  true,
			})
			err = filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
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
					out = append(out, expandedTransferFile{
						SourcePath:   path,
						RelativePath: rel,
						IsDirectory:  true,
					})
					return nil
				}
				cs, _ := computeFileSHA256(path)
				out = append(out, expandedTransferFile{
					SourcePath:   path,
					RelativePath: rel,
					SizeBytes:    info.Size(),
					Checksum:     cs,
				})
				return nil
			})
			if err != nil {
				return nil, err
			}
			continue
		}
		cs, _ := computeFileSHA256(file.Path)
		out = append(out, expandedTransferFile{
			SourcePath:   file.Path,
			RelativePath: file.Name,
			SizeBytes:    info.Size(),
			Checksum:     cs,
		})
	}
	return out, nil
}

func (s *ServerState) writeTransferMultipart(mw *multipart.Writer, transferID string, manifest []expandedTransferFile, progress func(int64, int64)) error {
	total := int64(0)
	for _, entry := range manifest {
		if !entry.IsDirectory {
			total += entry.SizeBytes
		}
	}
	meta := map[string]any{
		"transferId": transferID,
		"peerId":     s.DeviceID,
		"deviceName": s.DeviceName,
		"files":      manifestToMeta(manifest),
	}
	metaPart, err := mw.CreateFormField("metadata")
	if err != nil {
		return err
	}
	if err := json.NewEncoder(metaPart).Encode(meta); err != nil {
		return err
	}
	var copied int64
	for idx, entry := range manifest {
		partHeader, err := mw.CreateFormField(fmt.Sprintf("file-%d", idx))
		if err != nil {
			return err
		}
		if err := json.NewEncoder(partHeader).Encode(map[string]any{
			"relativePath": entry.RelativePath,
			"isDir":        entry.IsDirectory,
			"size":         entry.SizeBytes,
			"checksum":     entry.Checksum,
		}); err != nil {
			return err
		}
		if entry.IsDirectory {
			progress(copied, total)
			continue
		}
		if err := copyFileWithProgress(partHeader, entry.SourcePath, func(n int64) {
			copied += n
			progress(copied, total)
		}); err != nil {
			return err
		}
	}
	return nil
}

func manifestToMeta(manifest []expandedTransferFile) []map[string]any {
	out := make([]map[string]any, 0, len(manifest))
	for _, entry := range manifest {
		out = append(out, map[string]any{
			"relativePath": entry.RelativePath,
			"isDir":        entry.IsDirectory,
			"size":         entry.SizeBytes,
			"checksum":     entry.Checksum,
		})
	}
	return out
}

func copyFileWithProgress(dst io.Writer, sourcePath string, onChunk func(int64)) error {
	src, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer src.Close()
	buf := make([]byte, 32*1024)
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, err := dst.Write(buf[:n]); err != nil {
				return err
			}
			onChunk(int64(n))
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func (s *ServerState) findPeer(id string) Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.Peers {
		if p.ID == id {
			return p
		}
	}
	return Device{}
}

func (s *ServerState) CreateShare(req ShareRequest) (map[string]any, error) {
	if len(req.Files) == 0 {
		return nil, fmt.Errorf("no files selected")
	}
	token := randomToken(16)
	expires := time.Now().Add(10 * time.Minute)
	if req.ExpiresIn > 0 {
		expires = time.Now().Add(time.Duration(req.ExpiresIn) * time.Second)
	}
	path := req.Files[0]
	s.mu.Lock()
	s.shares[token] = shareRecord{Token: token, Path: path, ExpiresAt: expires, Password: req.Password}
	s.mu.Unlock()
	return map[string]any{
		"url":       fmt.Sprintf("http://127.0.0.1:%d/s/%s", s.HTTPPort, token),
		"token":     token,
		"expiresAt": expires,
	}, nil
}

func (s *ServerState) ServeShare(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/s/"), "/")
	token := parts[0]
	s.mu.Lock()
	share, ok := s.shares[token]
	s.mu.Unlock()
	if !ok || time.Now().After(share.ExpiresAt) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		if info, err := os.Stat(share.Path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, share.Path)
			return
		}
		http.Error(w, "share path unavailable", http.StatusNotFound)
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func deviceType(osName string) string {
	switch strings.ToLower(osName) {
	case "darwin", "macos":
		return "mac"
	case "windows", "linux":
		return "pc"
	default:
		return "phone"
	}
}

func formatOSName(osName string) string {
	switch strings.ToLower(osName) {
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
		return osName
	}
}

func getBroadcastAddresses(port int) []*net.UDPAddr {
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
		unicastAddrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range unicastAddrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}
			ip := ipNet.IP.To4()
			mask := ipNet.Mask
			if len(mask) == 4 {
				bcastIP := net.IP(make([]byte, 4))
				for i := 0; i < 4; i++ {
					bcastIP[i] = ip[i] | ^mask[i]
				}
				addrs = append(addrs, &net.UDPAddr{IP: bcastIP, Port: port})
			}
		}
	}
	return addrs
}

func computeFileSHA256(path string) (string, error) {
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

func intFrom(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}

func stringFrom(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func stringSlice(v any) []string {
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