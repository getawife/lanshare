package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
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
	state, err := new_server_state()
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
	http_server *http.Server
}

func new_backend(state *server_state) *backend {
	mux := http.NewServeMux()
	b := &backend{state: state}
	mux.HandleFunc("/api/health", b.health)
	mux.HandleFunc("/api/state", b.state_handler)
	mux.HandleFunc("/api/devices", b.devices)
	mux.HandleFunc("/api/events", b.events)
	mux.HandleFunc("/api/transfer", b.transfer)
	mux.HandleFunc("/api/prepare-transfer", b.prepare_transfer)
	mux.HandleFunc("/api/respond-transfer", b.respond_transfer)
	mux.HandleFunc("/api/receive", b.receive)
	mux.HandleFunc("/api/share", b.share)
	mux.HandleFunc("/api/settings", b.settings_handler)
	mux.HandleFunc("/s/", b.serve_share)
	b.http_server = &http.Server{Handler: with_cors(mux)}
	return b
}

func (b *backend) start(ctx context.Context) error {
	http_port := default_http_port
	if v := os.Getenv("LANSHARE_HTTP_PORT"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			http_port = parsed
		}
	}
	var http_ln net.Listener
	var err error
	for _, candidate := range candidate_ports(http_port, 10) {
		http_ln, err = net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", candidate))
		if err == nil {
			http_port = candidate
			break
		}
	}
	if http_ln == nil {
		return fmt.Errorf(
			"failed to bind HTTP server: all candidate ports (%d-%d) are in use",
			http_port,
			http_port+9,
		)
	}
	b.state.http_port = http_ln.Addr().(*net.TCPAddr).Port
	b.state.admin_token = os.Getenv("LANSHARE_ADMIN_TOKEN")
	if b.state.admin_token == "" {
		log.Printf("[Security] no LANSHARE_ADMIN_TOKEN provided; privileged endpoints will be disabled")
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
		"LANShare backend ready: http=127.0.0.1:%d lan=%d",
		b.state.http_port,
		b.state.lan_port,
	)
	go func() {
		<-ctx.Done()
		_ = http_ln.Close()
		_ = lan_ln.Close()
	}()
	err_ch := make(chan error, 2)
	go func() {
		err_ch <- b.http_server.Serve(http_ln)
	}()
	go func() {
		err_ch <- b.state.run_discovery_listener(ctx, lan_ln)
	}()
	select {
	case <-ctx.Done():
	case err := <-err_ch:
		if err != nil && !errors.Is(err, net.ErrClosed) {
			return err
		}
	}
	shutdown_ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = b.http_server.Shutdown(shutdown_ctx)
	_ = lan_ln.Close()
	return nil
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

func with_cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !is_allowed_origin(origin) {
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization, X-Lanshare-Token, X-Lanshare-Transfer-Token",
			)
			w.Header().Set(
				"Access-Control-Allow-Methods",
				"GET,POST,OPTIONS",
			)
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (b *backend) health(w http.ResponseWriter, r *http.Request) {
	write_json(w, map[string]any{
		"ok":          true,
		"platform":    runtime.GOOS,
		"diagnostics": b.state.get_diagnostics(),
	})
}

func (b *backend) prepare_transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(w, http.StatusMethodNotAllowed, "B-P000", "method not allowed")
		return
	}
	var req transfer_request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(w, http.StatusBadRequest, "B-P001", "invalid prepare transfer payload")
		return
	}
	if req.peer_id == "" || len(req.files) == 0 {
		write_error_json(w, http.StatusBadRequest, "B-P002", "missing peer or files")
		return
	}
	transfer_id := req.transfer_id
	if transfer_id == "" {
		transfer_id = random_token(8)
	}
	settings := b.state.get_settings()
	if !settings.ask_before_accepting {
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
	peer := b.state.find_peer(req.peer_id)
	if settings.auto_accept_trusted && peer.id != "" && peer.trusted {
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
	device_name := req.device_name
	if device_name == "" {
		if peer.id != "" && peer.name != "" {
			device_name = peer.name
		} else {
			device_name = "Nearby device"
		}
	}
	ch := make(chan transfer_decision, 1)
	b.state.mu.Lock()
	b.state.pending_transfers[transfer_id] = ch
	b.state.mu.Unlock()
	b.state.publish(event{
		type_: "incoming-transfer-request",
		data: map[string]any{
			"transferId": transfer_id,
			"peerId":     req.peer_id,
			"deviceName": device_name,
			"files":      req.files,
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
	case <-time.After(30 * time.Second):
		b.state.mu.Lock()
		delete(b.state.pending_transfers, transfer_id)
		b.state.mu.Unlock()
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
			fmt.Fprintf(w, "event: %s\n", evt.type_)
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (b *backend) transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		write_error_json(
			w,
			http.StatusMethodNotAllowed,
			"B-T000",
			"method not allowed",
		)
		return
	}
	var req transfer_request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-T001",
			"invalid transfer request",
		)
		return
	}
	if req.peer_id == "" || len(req.files) == 0 {
		write_error_json(
			w,
			http.StatusBadRequest,
			"B-T002",
			"missing peer or files",
		)
		return
	}
	b.state.publish(event{
		type_: "transfer",
		data: map[string]any{
			"id":        req.transfer_id,
			"peerId":    req.peer_id,
			"state":     "transferring",
			"direction": "outgoing",
			"files":     req.files,
		},
	})
	if err := b.state.send_files(r.Context(), req); err != nil {
		b.state.publish(event{
			type_: "transfer",
			data: map[string]any{
				"id":           req.transfer_id,
				"peerId":       req.peer_id,
				"state":        "failed",
				"direction":    "outgoing",
				"files":        req.files,
				"errorMessage": err.Error(),
			},
		})
		write_error_json(
			w,
			http.StatusBadGateway,
			"B-T010",
			err.Error(),
		)
		return
	}
	b.state.publish(event{
		type_: "transfer",
		data: map[string]any{
			"id":        req.transfer_id,
			"peerId":    req.peer_id,
			"state":     "completed",
			"direction": "outgoing",
			"files":     req.files,
		},
	})
	write_json(w, map[string]any{"ok": true})
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
	uploaded := int64(0)
	total := int64(0)
	for _, file := range meta.Files {
		if !file.IsDir {
			total += file.Size
		}
	}
	b.state.publish(event{
		type_: "transfer",
		data: map[string]any{
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
	if custom := b.state.get_settings().download_folder; custom != "" {
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
				type_: "transfer",
				data: map[string]any{
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
				type_: "transfer",
				data: map[string]any{
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
			type_: "transfer",
			data: map[string]any{
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
	}
	b.state.publish(event{
		type_: "transfer",
		data: map[string]any{
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