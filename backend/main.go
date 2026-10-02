package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const default_http_port = 43821
const default_loopback_peer_port = 43822

func main() {
	user_data_dir := os.Getenv("LANSHARE_USER_DATA_DIR")
	if user_data_dir == "" {
		user_data_dir = default_user_data_dir()
	}

	identity, err := load_or_create_identity(user_data_dir)
	if err != nil {
		log.Fatalf("failed to load device identity: %v", err)
	}

	trusted_ids, err := load_trusted_ids(user_data_dir)
	if err != nil {
		log.Fatalf("failed to load trusted devices: %v", err)
	}

	state, err := new_server_state(identity, user_data_dir, trusted_ids)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	server := new_backend(state)
	if err := server.start(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func random_token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

type backend struct {
	state      *server_state
	ui_server  *http.Server
	lan_server *http.Server
}

func new_backend(state *server_state) *backend {
	b := &backend{state: state}
	ui := http.NewServeMux()
	ui.HandleFunc("/api/health", b.health)
	ui.HandleFunc("/api/state", b.state_handler)
	ui.HandleFunc("/api/devices", b.devices)
	ui.HandleFunc("/api/events", b.events)
	ui.HandleFunc("/api/transfer", b.transfer)
	ui.HandleFunc("/api/respond-transfer", b.respond_transfer)
	ui.HandleFunc("/api/cancel-transfer", b.cancel_transfer)
	ui.HandleFunc("/api/share", b.share)
	ui.HandleFunc("/api/settings", b.settings_handler)
	ui.HandleFunc("/api/trust", b.trust_handler)
	lan := http.NewServeMux()
	lan.HandleFunc("/api/health", b.lan_health)
	lan.HandleFunc("/api/prepare-transfer", b.prepare_transfer)
	lan.HandleFunc("/api/receive", b.receive)
	lan.HandleFunc("/s/", b.serve_share)
	b.ui_server = &http.Server{Handler: b.ui_guard(ui)}
	b.lan_server = &http.Server{Handler: lan, ReadHeaderTimeout: 10 * time.Second}
	return b
}

func (b *backend) start(ctx context.Context) error {
	ui_ln, err := listen_first("127.0.0.1", env_port("LANSHARE_HTTP_PORT", default_http_port))
	if err != nil {
		return fmt.Errorf("failed to bind UI server: %w", err)
	}
	peer_raw_ln, err := listen_first("0.0.0.0", env_port("LANSHARE_LAN_HTTP_PORT", default_http_port+20))
	if err != nil {
		_ = ui_ln.Close()
		return fmt.Errorf("failed to bind LAN server: %w", err)
	}
	peer_ln := tls.NewListener(peer_raw_ln, b.state.tls_config())
	b.state.http_port = ui_ln.Addr().(*net.TCPAddr).Port
	b.state.lan_http_port = peer_raw_ln.Addr().(*net.TCPAddr).Port
	b.state.admin_token = os.Getenv("LANSHARE_ADMIN_TOKEN")
	if b.state.admin_token == "" {
		log.Printf("[Security] no LANSHARE_ADMIN_TOKEN provided; the local API will reject all requests")
	}
	lan_ln, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", discovery_port))
	if err == nil {
		b.state.udp_discovery_bound = true
	} else {
		b.state.udp_discovery_bound = false
		lan_ln, err = net.ListenPacket("udp4", ":0")
		if err != nil {
			return fmt.Errorf("failed to bind UDP discovery packet listener: %w", err)
		}
	}
	b.state.lan_port = lan_ln.LocalAddr().(*net.UDPAddr).Port
	go b.state.run_discovery(ctx, lan_ln)
	go b.state.run_expired_peer_sweep(ctx)
	go b.state.run_loopback_peer_probe(ctx)
	log.Printf(
		"LANShare backend ready: ui=127.0.0.1:%d peers=%d discovery=%d",
		b.state.http_port,
		b.state.lan_http_port,
		b.state.lan_port,
	)
	go func() {
		<-ctx.Done()
		_ = ui_ln.Close()
		_ = peer_ln.Close()
		_ = lan_ln.Close()
	}()
	err_ch := make(chan error, 3)
	go func() { err_ch <- b.ui_server.Serve(ui_ln) }()
	go func() { err_ch <- b.lan_server.Serve(peer_ln) }()
	go func() { err_ch <- b.state.run_discovery_listener(ctx, lan_ln) }()
	select {
	case <-ctx.Done():
	case err := <-err_ch:
		if err != nil && !errors.Is(err, net.ErrClosed) {
			return err
		}
	}
	shutdown_ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = b.ui_server.Shutdown(shutdown_ctx)
	_ = b.lan_server.Shutdown(shutdown_ctx)
	_ = lan_ln.Close()
	return nil
}

func env_port(name string, fallback int) int {
	if v := os.Getenv(name); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed < 65536 {
			return parsed
		}
	}
	return fallback
}

func listen_first(host string, start int) (net.Listener, error) {
	var last error
	for _, candidate := range candidate_ports(start, 10) {
		ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, candidate))
		if err == nil {
			return ln, nil
		}
		last = err
	}
	return nil, last
}

func is_allowed_origin(origin string) bool {
	if origin == "null" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(u.Hostname())
	return hostname == "127.0.0.1" || hostname == "localhost"
}

func (b *backend) token_valid(r *http.Request) bool {
	want := b.state.admin_token
	if want == "" {
		return false
	}
	got := r.Header.Get("X-Lanshare-Token")
	if got == "" && r.URL.Path == "/api/events" {
		got = r.URL.Query().Get("token")
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (b *backend) ui_guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			if !is_allowed_origin(origin) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Lanshare-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path != "/api/health" && !b.token_valid(r) {
			write_error_json(w, http.StatusUnauthorized, "B-A001", "missing or invalid admin token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (b *backend) health(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"ok": true, "platform": runtime.GOOS}
	if b.token_valid(r) {
		out["diagnostics"] = b.state.get_diagnostics()
	}
	write_json(w, out)
}

func (b *backend) lan_health(w http.ResponseWriter, r *http.Request) {
	write_json(w, map[string]any{"ok": true})
}

func (b *backend) prepare_transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(w, http.StatusMethodNotAllowed, "B-P000", "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req transfer_request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(w, http.StatusBadRequest, "B-P001", "invalid prepare transfer payload")
		return
	}
	if req.PeerID == "" || len(req.Files) == 0 {
		write_error_json(w, http.StatusBadRequest, "B-P002", "missing peer or files")
		return
	}
	transfer_id := req.TransferID
	if transfer_id == "" {
		transfer_id = random_token(8)
	}
	settings := b.state.get_settings()
	if !settings.AskBeforeAccepting {
		token := random_token(16)
		b.state.mu.Lock()
		b.state.allowed_transfer_tokens[token] = allowed_token{
			transfer_id: transfer_id,
			expires_at:  time.Now().Add(30 * time.Second),
		}
		b.state.mu.Unlock()
		write_json(w, map[string]any{
			"ok":    true,
			"token": token,
		})
		return
	}
	peer := b.state.find_peer(req.PeerID)
	if settings.AutoAcceptTrusted && peer.ID != "" && peer.Trusted && peer.CertFP != "" && peer.CertFP == sender_fingerprint(r) {
		token := random_token(16)
		b.state.mu.Lock()
		b.state.allowed_transfer_tokens[token] = allowed_token{
			transfer_id: transfer_id,
			expires_at:  time.Now().Add(30 * time.Second),
		}
		b.state.mu.Unlock()
		write_json(w, map[string]any{
			"ok":    true,
			"token": token,
		})
		return
	}
	device_name := req.DeviceName
	if device_name == "" {
		if peer.ID != "" && peer.Name != "" {
			device_name = peer.Name
		} else {
			device_name = "Nearby device"
		}
	}
	ch := make(chan transfer_decision, 1)
	b.state.mu.Lock()
	b.state.pending_transfers[transfer_id] = ch
	b.state.mu.Unlock()
	b.state.publish(event{
		Type: "incoming-transfer-request",
		Data: map[string]any{
			"transferId": transfer_id,
			"peerId":     req.PeerID,
			"deviceName": device_name,
			"files":      req.Files,
		},
	})
	select {
	case dec := <-ch:
		if dec.accepted {
			b.state.mu.Lock()
			b.state.allowed_transfer_tokens[dec.token] = allowed_token{
				transfer_id: transfer_id,
				expires_at:  time.Now().Add(30 * time.Second),
			}
			b.state.mu.Unlock()
			write_json(w, map[string]any{
				"ok":    true,
				"token": dec.token,
			})
			return
		}
		write_error_json(
			w,
			http.StatusForbidden,
			"B-P003",
			"transfer rejected by user",
		)
	case <-r.Context().Done():
		b.drop_pending(transfer_id, device_name, req.Files)
	case <-time.After(30 * time.Second):
		b.drop_pending(transfer_id, device_name, req.Files)
		write_error_json(
			w,
			http.StatusRequestTimeout,
			"B-P004",
			"user did not respond to transfer request in time",
		)
	}
}

func (b *backend) respond_transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(w, http.StatusMethodNotAllowed, "B-RP000", "method not allowed")
		return
	}
	header := r.Header.Get("X-Lanshare-Token")
	if b.state.admin_token == "" {
		write_error_json(
			w,
			http.StatusUnauthorized,
			"B-RP004",
			"admin token not configured on server",
		)
		return
	}
	if header != b.state.admin_token {
		write_error_json(
			w,
			http.StatusUnauthorized,
			"B-RP001",
			"invalid admin token",
		)
		return
	}
	var req struct {
		TransferID string `json:"transferId"`
		Accept     bool   `json:"accept"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(w, http.StatusBadRequest, "B-RP002", "invalid payload")
		return
	}
	b.state.mu.Lock()
	ch, ok := b.state.pending_transfers[req.TransferID]
	if !ok {
		b.state.mu.Unlock()
		write_error_json(
			w,
			http.StatusNotFound,
			"B-RP003",
			"no pending transfer",
		)
		return
	}
	if req.Accept {
		token := random_token(16)
		ch <- transfer_decision{
			accepted: true,
			token:    token,
		}
		delete(b.state.pending_transfers, req.TransferID)
		b.state.mu.Unlock()
		write_json(w, map[string]any{"ok": true})
		return
	}
	ch <- transfer_decision{
		accepted: false,
	}
	delete(b.state.pending_transfers, req.TransferID)
	b.state.mu.Unlock()
	write_json(w, map[string]any{"ok": true})
}

func (b *backend) state_handler(w http.ResponseWriter, r *http.Request) {
	write_json(w, b.state.snapshot())
}

func (b *backend) settings_handler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		header := r.Header.Get("X-Lanshare-Token")
		if b.state.admin_token == "" {
			write_error_json(
				w,
				http.StatusUnauthorized,
				"B-S003",
				"admin token not configured on server",
			)
			return
		}
		if header != b.state.admin_token {
			write_error_json(
				w,
				http.StatusUnauthorized,
				"B-S002",
				"invalid admin token",
			)
			return
		}
	}
	switch r.Method {
	case http.MethodGet:
		write_json(w, b.state.get_settings())
	case http.MethodPost:
		var cfg backend_settings
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-S001",
				"invalid settings payload",
			)
			return
		}
		b.state.update_settings(cfg)
		write_json(w, map[string]any{"ok": true})
	default:
		write_error_json(
			w,
			http.StatusMethodNotAllowed,
			"B-S000",
			"method not allowed",
		)
	}
}

func (b *backend) trust_handler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		write_json(w, map[string]any{
			"ok":          true,
			"trusted_ids": b.state.list_trusted(),
		})
	case http.MethodPost:
		header := r.Header.Get("X-Lanshare-Token")
		if b.state.admin_token == "" {
			write_error_json(
				w,
				http.StatusUnauthorized,
				"B-TR003",
				"admin token not configured on server",
			)
			return
		}
		if header != b.state.admin_token {
			write_error_json(
				w,
				http.StatusUnauthorized,
				"B-TR002",
				"invalid admin token",
			)
			return
		}
		var req struct {
			PeerID  string `json:"peerId"`
			Trusted bool   `json:"trusted"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-TR001",
				"invalid trust payload",
			)
			return
		}
		if err := b.state.set_trusted(req.PeerID, req.Trusted); err != nil {
			write_error_json(
				w,
				http.StatusInternalServerError,
				"B-TR004",
				"failed to persist trust change",
			)
			return
		}
		write_json(w, map[string]any{"ok": true})
	default:
		write_error_json(
			w,
			http.StatusMethodNotAllowed,
			"B-TR000",
			"method not allowed",
		)
	}
}

func candidate_ports(start, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = start + i
	}
	return out
}

func (b *backend) devices(w http.ResponseWriter, r *http.Request) {
	write_json(w, b.state.peers_snapshot())
}

func (b *backend) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(
			w,
			"streaming unsupported",
			http.StatusInternalServerError,
		)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := b.state.subscribe()
	defer b.state.unsubscribe(ch)
	for {
		select {
		case <-r.Context().Done():
			return
		case evt := <-ch:
			payload, _ := json.Marshal(evt)
			fmt.Fprintf(w, "event: %s\n", evt.Type)
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (b *backend) transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(w, http.StatusMethodNotAllowed, "B-T000", "method not allowed")
		return
	}
	var req transfer_request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(w, http.StatusBadRequest, "B-T001", "invalid transfer request")
		return
	}
	if req.PeerID == "" || len(req.Files) == 0 {
		write_error_json(w, http.StatusBadRequest, "B-T002", "missing peer or files")
		return
	}
	if req.TransferID == "" {
		req.TransferID = random_token(8)
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if !b.state.register_send(req.TransferID, cancel) {
		write_error_json(w, http.StatusConflict, "B-T003", "transfer id already in use")
		return
	}
	defer b.state.finish_send(req.TransferID)
	transfer_event := func(state string, extra map[string]any) {
		data := map[string]any{
			"id":        req.TransferID,
			"peerId":    req.PeerID,
			"state":     state,
			"direction": "outgoing",
			"files":     req.Files,
		}
		for k, v := range extra {
			data[k] = v
		}
		b.state.publish(event{Type: "transfer", Data: data})
	}
	transfer_event("transferring", nil)
	if err := b.state.send_files(ctx, req); err != nil {
		if ctx.Err() != nil {
			transfer_event("cancelled", nil)
			write_error_json(w, http.StatusConflict, "B-T011", "transfer cancelled")
			return
		}
		transfer_event("failed", map[string]any{"errorMessage": err.Error()})
		write_error_json(w, http.StatusBadGateway, "B-T010", err.Error())
		return
	}
	transfer_event("completed", nil)
	write_json(w, map[string]any{"ok": true})
}

func (b *backend) cancel_transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(w, http.StatusMethodNotAllowed, "B-C000", "method not allowed")
		return
	}
	var req struct {
		TransferID string `json:"transferId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(w, http.StatusBadRequest, "B-C001", "invalid cancel request")
		return
	}
	if !b.state.cancel_send(req.TransferID) {
		write_error_json(w, http.StatusNotFound, "B-C002", "no active transfer")
		return
	}
	write_json(w, map[string]any{"ok": true})
}

func (b *backend) drop_pending(id string, name string, files []file_item) {
	b.state.mu.Lock()
	delete(b.state.pending_transfers, id)
	b.state.mu.Unlock()
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":         id,
		"deviceName": name,
		"state":      "cancelled",
		"direction":  "incoming",
		"files":      files,
	}})
}

func (b *backend) receive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(
			w,
			http.StatusMethodNotAllowed,
			"B-R000",
			"method not allowed",
		)
		return
	}
	token := r.Header.Get("X-Lanshare-Transfer-Token")
	if token == "" {
		write_error_json(
			w,
			http.StatusUnauthorized,
			"B-R020",
			"missing transfer token",
		)
		return
	}
	b.state.mu.Lock()
	at, ok := b.state.allowed_transfer_tokens[token]
	if !ok || time.Now().After(at.expires_at) {
		b.state.mu.Unlock()
		write_error_json(
			w,
			http.StatusForbidden,
			"B-R021",
			"invalid or expired transfer token",
		)
		return
	}
	delete(b.state.allowed_transfer_tokens, token)
	b.state.mu.Unlock()
	media_type, params, err := mime.ParseMediaType(
		r.Header.Get("Content-Type"),
	)
	if err != nil || !strings.HasPrefix(media_type, "multipart/") {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-R001",
			"expected multipart upload",
		)
		return
	}
	reader := multipart.NewReader(r.Body, params["boundary"])
	meta_part, err := reader.NextPart()
	if err != nil {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-R002",
			"missing metadata",
		)
		return
	}
	if meta_part.FormName() != "metadata" {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-R003",
			"missing metadata part",
		)
		return
	}
	var meta struct {
		TransferID string `json:"transferId"`
		PeerID     string `json:"peerId"`
		PeerName   string `json:"deviceName"`
		Files      []struct {
			RelativePath string `json:"relativePath"`
			IsDir        bool   `json:"isDir"`
			Size         int64  `json:"size"`
			Checksum     string `json:"checksum"`
		} `json:"files"`
	}
	if err := json.NewDecoder(meta_part).Decode(&meta); err != nil {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-R004",
			"invalid metadata",
		)
		return
	}
	if len(meta.Files) == 0 {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-R005",
			"missing files",
		)
		return
	}
	is_windows := runtime.GOOS == "windows"
	for i := range meta.Files {
		meta.Files[i].RelativePath = sanitize_relative_path(meta.Files[i].RelativePath, is_windows)
	}
	uploaded := int64(0)
	var completed_paths []string
	success := false
	defer func() {
		if !success {
			for _, p := range completed_paths {
				_ = os.Remove(p)
			}
		}
	}()
	total := int64(0)
	for _, file := range meta.Files {
		if !file.IsDir {
			total += file.Size
		}
	}
	b.state.publish(event{
		Type: "transfer",
		Data: map[string]any{
			"id":               meta.TransferID,
			"peerId":           meta.PeerID,
			"deviceName":       meta.PeerName,
			"state":            "transferring",
			"direction":        "incoming",
			"files":            meta.Files,
			"bytesTransferred": uploaded,
			"totalSizeBytes":   total,
		},
	})
	downloads := default_downloads()
	if custom := b.state.get_settings().DownloadFolder; custom != "" {
		downloads = custom
	}
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		write_error_json(
			w,
			http.StatusInternalServerError,
			"B-R006",
			"unable to prepare download folder",
		)
		return
	}
	for idx, file := range meta.Files {
		if file.IsDir {
			target_dir, err := safe_download_path(
				downloads,
				file.RelativePath,
			)
			if err != nil {
				write_error_json(
					w,
					http.StatusBadRequest,
					"B-R007",
					"unsafe folder path rejected",
				)
				return
			}
			if err := os.MkdirAll(target_dir, 0o755); err != nil {
				write_error_json(
					w,
					http.StatusInternalServerError,
					"B-R008",
					"unable to create folder",
				)
				return
			}
			if _, err := reader.NextPart(); err != nil && !errors.Is(err, io.EOF) {
				write_error_json(
					w,
					http.StatusBadRequest,
					"B-R017",
					"missing folder payload",
				)
				return
			}
			continue
		}
		part, err := reader.NextPart()
		if err != nil {
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-R009",
				"missing file payload",
			)
			return
		}
		expected_name := fmt.Sprintf("file-%d", idx)
		if part.FormName() != expected_name {
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-R010",
				"unexpected file order",
			)
			return
		}
		target_path, err := safe_download_path(
			downloads,
			file.RelativePath,
		)
		if err != nil {
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-R011",
				"unsafe file path rejected",
			)
			return
		}
		target_path = get_unique_file_path(target_path)
		if err := os.MkdirAll(filepath.Dir(target_path), 0o755); err != nil {
			write_error_json(
				w,
				http.StatusInternalServerError,
				"B-R012",
				"unable to create parent folder",
			)
			return
		}
		tmp := target_path + ".part"
		dst, err := os.Create(tmp)
		if err != nil {
			write_error_json(
				w,
				http.StatusInternalServerError,
				"B-R013",
				"unable to create destination file",
			)
			return
		}
		hasher := sha256.New()
		multi_writer := io.MultiWriter(dst, hasher)
		written, copy_err := io.Copy(multi_writer, part)
		_ = dst.Close()
		if copy_err != nil {
			_ = os.Remove(tmp)
			b.state.publish(event{
				Type: "transfer",
				Data: map[string]any{
					"id":               meta.TransferID,
					"peerId":           meta.PeerID,
					"deviceName":       meta.PeerName,
					"state":            "failed",
					"direction":        "incoming",
					"files":            meta.Files,
					"errorMessage":     copy_err.Error(),
					"bytesTransferred": uploaded,
					"totalSizeBytes":   total,
				},
			})
			write_error_json(
				w,
				http.StatusBadGateway,
				"B-R014",
				"file copy failed",
			)
			return
		}
		computed_checksum := hex.EncodeToString(hasher.Sum(nil))
		if file.Checksum != "" && computed_checksum != file.Checksum {
			_ = os.Remove(tmp)
			b.state.publish(event{
				Type: "transfer",
				Data: map[string]any{
					"id":               meta.TransferID,
					"peerId":           meta.PeerID,
					"deviceName":       meta.PeerName,
					"state":            "failed",
					"direction":        "incoming",
					"files":            meta.Files,
					"errorMessage":     "checksum mismatch (corrupted download)",
					"bytesTransferred": uploaded,
					"totalSizeBytes":   total,
				},
			})
			write_error_json(
				w,
				http.StatusBadRequest,
				"B-R016",
				"checksum mismatch (corrupted download)",
			)
			return
		}
		uploaded += written
		b.state.publish(event{
			Type: "transfer",
			Data: map[string]any{
				"id":               meta.TransferID,
				"peerId":           meta.PeerID,
				"deviceName":       meta.PeerName,
				"state":            "transferring",
				"direction":        "incoming",
				"files":            meta.Files,
				"bytesTransferred": uploaded,
				"totalSizeBytes":   total,
			},
		})
		if err := os.Rename(tmp, target_path); err != nil {
			_ = os.Remove(tmp)
			write_error_json(
				w,
				http.StatusInternalServerError,
				"B-R015",
				"unable to finalize file",
			)
			return
		}
		completed_paths = append(completed_paths, target_path)
	}
	b.state.publish(event{
		Type: "transfer",
		Data: map[string]any{
			"id":               meta.TransferID,
			"peerId":           meta.PeerID,
			"deviceName":       meta.PeerName,
			"state":            "completed",
			"direction":        "incoming",
			"files":            meta.Files,
			"bytesTransferred": total,
			"totalSizeBytes":   total,
		},
	})
	success = true
	write_json(w, map[string]any{"ok": true})
}

func (b *backend) share(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(
			w,
			"method not allowed",
			http.StatusMethodNotAllowed,
		)
		return
	}
	var req share_request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(
			w,
			err.Error(),
			http.StatusBadRequest,
		)
		return
	}
	share, err := b.state.create_share(req)
	if err != nil {
		http.Error(
			w,
			err.Error(),
			http.StatusBadRequest,
		)
		return
	}
	write_json(w, share)
}

func (b *backend) serve_share(w http.ResponseWriter, r *http.Request) {
	b.state.serve_share(w, r)
}

func default_downloads() string {
	if d, err := os.UserHomeDir(); err == nil && d != "" {
		return filepath.Join(d, "Downloads")
	}
	return "."
}

func write_json(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func write_error_json(
	w http.ResponseWriter,
	status int,
	code string,
	message string,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      false,
		"code":    code,
		"message": message,
	})
}

func safe_download_path(
	base_dir string,
	relative_path string,
) (string, error) {
	clean := filepath.Clean(
		filepath.FromSlash(relative_path),
	)
	if clean == "." || clean == string(filepath.Separator) {
		return "", fmt.Errorf("invalid path")
	}
	if vol := filepath.VolumeName(clean); vol != "" {
		clean = strings.TrimPrefix(clean, vol)
	}
	clean = strings.TrimLeft(clean, `/\`)
	if clean == "" {
		return "", fmt.Errorf("invalid path")
	}
	target := filepath.Join(base_dir, clean)
	base_abs, err := filepath.Abs(base_dir)
	if err != nil {
		return "", err
	}
	target_abs, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	prefix := base_abs + string(filepath.Separator)
	if target_abs != base_abs &&
		!strings.HasPrefix(target_abs, prefix) {
		return "", fmt.Errorf("unsafe path rejected")
	}
	return target, nil
}

func get_unique_file_path(target_path string) string {
	if _, err := os.Stat(target_path); errors.Is(err, os.ErrNotExist) {
		return target_path
	}
	dir := filepath.Dir(target_path)
	ext := filepath.Ext(target_path)
	base := strings.TrimSuffix(
		filepath.Base(target_path),
		ext,
	)
	for i := 1; i < 10000; i++ {
		candidate := filepath.Join(
			dir,
			fmt.Sprintf("%s (%d)%s", base, i, ext),
		)
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return target_path
}