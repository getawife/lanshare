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
	"net"
	"net/http"
	"mime"
	"mime/multipart"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const defaultHTTPPort = 43821
const defaultLoopbackPeerPort = 43822

func main() {
	state, err := NewServerState()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	server := NewBackend(state)
	if err := server.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

type Backend struct {
	state      *ServerState
	httpServer *http.Server
}

func NewBackend(state *ServerState) *Backend {
	mux := http.NewServeMux()
	b := &Backend{state: state}
	mux.HandleFunc("/api/health", b.health)
	mux.HandleFunc("/api/state", b.stateHandler)
	mux.HandleFunc("/api/devices", b.devices)
	mux.HandleFunc("/api/events", b.events)
	mux.HandleFunc("/api/transfer", b.transfer)
	mux.HandleFunc("/api/prepare-transfer", b.prepareTransfer)
	mux.HandleFunc("/api/respond-transfer", b.respondTransfer)
	mux.HandleFunc("/api/receive", b.receive)
	mux.HandleFunc("/api/share", b.share)
	mux.HandleFunc("/api/settings", b.settingsHandler)
	mux.HandleFunc("/s/", b.serveShare)
	b.httpServer = &http.Server{Handler: withCORS(mux)}
	return b
}

func (b *Backend) Start(ctx context.Context) error {
	httpPort := defaultHTTPPort
	if v := os.Getenv("LANSHARE_HTTP_PORT"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			httpPort = parsed
		}
	}
	// Issue 5.1: try the preferred port first, then fall back to a range of
	// nearby ports so a leftover orphan process doesn't crash the app.
	var httpLn net.Listener
	var err error
	for _, candidate := range candidatePorts(httpPort, 10) {
		httpLn, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", candidate))
		if err == nil {
			httpPort = candidate
			break
		}
	}
	if httpLn == nil {
		return fmt.Errorf("failed to bind HTTP server: all candidate ports (%d–%d) are in use", defaultHTTPPort, defaultHTTPPort+9)
	}
	b.state.HTTPPort = httpLn.Addr().(*net.TCPAddr).Port
	// Harden admin token policy: require the LANSHARE_ADMIN_TOKEN to be set by the
	// Electron host. If not set, privileged endpoints will reject requests.
	b.state.AdminToken = os.Getenv("LANSHARE_ADMIN_TOKEN")
	if b.state.AdminToken == "" {
		// Log a warning — by default we will deny privileged actions when token is missing.
		log.Printf("[Security] no LANSHARE_ADMIN_TOKEN provided; privileged endpoints will be disabled")
	}

	lanLn, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", discoveryPort))
	if err == nil {
		b.state.UDPDiscoveryBound = true
	} else {
		b.state.UDPDiscoveryBound = false
		lanLn, err = net.ListenPacket("udp4", ":0")
		if err != nil {
			return fmt.Errorf("failed to bind UDP discovery packet listener: %w", err)
		}
	}
	b.state.LANPort = lanLn.LocalAddr().(*net.UDPAddr).Port

	go b.state.RunDiscovery(ctx, lanLn)
	go b.state.RunExpiredPeerSweep(ctx)
	go b.state.RunLoopbackPeerProbe(ctx)

	log.Printf("LANShare backend ready: http=127.0.0.1:%d lan=%d", b.state.HTTPPort, b.state.LANPort)

	// Force close if context is cancelled
	go func() {
		<-ctx.Done()
		_ = httpLn.Close()
		_ = lanLn.Close()
	}()

	errCh := make(chan error, 2)
	go func() { errCh <- b.httpServer.Serve(httpLn) }()
	go func() { errCh <- b.state.RunDiscoveryListener(ctx, lanLn) }()

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil && !errors.Is(err, net.ErrClosed) {
			return err
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = b.httpServer.Shutdown(shutdownCtx)
	_ = lanLn.Close()
	return nil
}

func withCORS(next http.Handler) http.Handler {
	// Restrict CORS to known renderer origins. Do not use wildcard in production.
	allowedOrigins := map[string]bool{
		"http://127.0.0.1:5173": true,
		"http://localhost:5173": true,
		// Some Electron environments may send Origin: "null" (file://), allow if needed.
		"null": true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !allowedOrigins[origin] {
				// For preflight requests from disallowed origins, deny.
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				// For non-preflight, continue without CORS headers (browser will block).
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Lanshare-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (b *Backend) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"ok":          true,
		"platform":    runtime.GOOS,
		"diagnostics": b.state.GetDiagnostics(),
	})
}

// prepareTransfer handles an initial sender request to initiate a transfer.
// The request is held until the local user accepts or rejects (or a timeout
// occurs). On acceptance the backend responds with a short-lived transfer
// token that the sender must present when POSTing file content to /api/receive.
func (b *Backend) prepareTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "B-P000", "method not allowed")
		return
	}
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorJSON(w, http.StatusBadRequest, "B-P001", "invalid prepare transfer payload")
		return
	}
	if req.PeerID == "" || len(req.Files) == 0 {
		writeErrorJSON(w, http.StatusBadRequest, "B-P002", "missing peer or files")
		return
	}
	transferID := req.TransferID
	if transferID == "" {
		transferID = randomToken(8)
	}

	// Enforce local policy: if AskBeforeAccepting is false, accept automatically.
	settings := b.state.GetSettings()
	if !settings.AskBeforeAccepting {
		// Auto-accept; generate a token and return immediately.
		token := randomToken(16)
		b.state.mu.Lock()
		b.state.allowedTransferTokens[token] = allowedToken{TransferID: transferID, ExpiresAt: time.Now().Add(30 * time.Second)}
		b.state.mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "token": token})
		return
	}

	// If peer is trusted and autoAcceptTrusted is set, accept automatically.
	peer := b.state.findPeer(req.PeerID)
	if settings.AutoAcceptTrusted && peer.ID != "" && peer.Trusted {
		token := randomToken(16)
		b.state.mu.Lock()
		b.state.allowedTransferTokens[token] = allowedToken{TransferID: transferID, ExpiresAt: time.Now().Add(30 * time.Second)}
		b.state.mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "token": token})
		return
	}

	// Otherwise, notify UI and wait for a user decision.
	ch := make(chan transferDecision, 1)
	b.state.mu.Lock()
	b.state.pendingTransfers[transferID] = ch
	b.state.mu.Unlock()
	// publish an event so UI can show prompt
	b.state.publish(event{Type: "incoming-transfer-request", Data: map[string]any{
		"transferId": transferID,
		"peerId":     req.PeerID,
		"deviceName": req.PeerID, // receiver can correlate
		"files":      req.Files,
	}})

	select {
	case dec := <-ch:
		if dec.Accepted {
			// ensure token is valid briefly
			b.state.mu.Lock()
			b.state.allowedTransferTokens[dec.Token] = allowedToken{TransferID: transferID, ExpiresAt: time.Now().Add(30 * time.Second)}
			b.state.mu.Unlock()
			writeJSON(w, map[string]any{"ok": true, "token": dec.Token})
			return
		}
		writeErrorJSON(w, http.StatusForbidden, "B-P003", "transfer rejected by user")
		return
	case <-time.After(30 * time.Second):
		// timeout
		b.state.mu.Lock()
		delete(b.state.pendingTransfers, transferID)
		b.state.mu.Unlock()
		writeErrorJSON(w, http.StatusRequestTimeout, "B-P004", "user did not respond to transfer request in time")
		return
	}
}

// respondTransfer is a privileged endpoint called by the local UI (Electron)
// to accept/reject a pending incoming transfer.
func (b *Backend) respondTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "B-RP000", "method not allowed")
		return
	}
	
	// Require admin token to ensure only the local UI can respond.
	header := r.Header.Get("X-Lanshare-Token")
	if b.state.AdminToken == "" {
		writeErrorJSON(w, http.StatusUnauthorized, "B-RP004", "admin token not configured on server")
		return
	}
	if header != b.state.AdminToken {
		writeErrorJSON(w, http.StatusUnauthorized, "B-RP001", "invalid admin token")
		return
	}
		
	var req struct {
		TransferID string `json:"transferId"`
		Accept     bool   `json:"accept"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorJSON(w, http.StatusBadRequest, "B-RP002", "invalid payload")
		return
	}
		
	b.state.mu.Lock()
	ch, ok := b.state.pendingTransfers[req.TransferID]
	if !ok {
		b.state.mu.Unlock()
		writeErrorJSON(w, http.StatusNotFound, "B-RP003", "no pending transfer")
		return
	}
	if req.Accept {
		token := randomToken(16)
		// send acceptance
		ch <- transferDecision{Accepted: true, Token: token}
		// cleanup
		delete(b.state.pendingTransfers, req.TransferID)
		b.state.mu.Unlock()
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	// reject
	ch <- transferDecision{Accepted: false}
	delete(b.state.pendingTransfers, req.TransferID)
	b.state.mu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func (b *Backend) stateHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, b.state.Snapshot())
}

// settingsHandler accepts a POST from Electron to push user settings into the backend,
// and responds to GET with the current settings.  This resolves Issue 2.2.
func (b *Backend) settingsHandler(w http.ResponseWriter, r *http.Request) {
	// Require the admin token for POST (privileged) operations.
	if r.Method == http.MethodPost {
		header := r.Header.Get("X-Lanshare-Token")
		if b.state.AdminToken == "" {
			writeErrorJSON(w, http.StatusUnauthorized, "B-S003", "admin token not configured on server")
			return
		}
		if header != b.state.AdminToken {
			writeErrorJSON(w, http.StatusUnauthorized, "B-S002", "invalid admin token")
			return
		}
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, b.state.GetSettings())
	case http.MethodPost:
		var cfg BackendSettings
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeErrorJSON(w, http.StatusBadRequest, "B-S001", "invalid settings payload")
			return
		}
		b.state.UpdateSettings(cfg)
		writeJSON(w, map[string]any{"ok": true})
	default:
		writeErrorJSON(w, http.StatusMethodNotAllowed, "B-S000", "method not allowed")
	}
}

// candidatePorts returns [start, start+1, … start+n-1] for port-fallback logic.
func candidatePorts(start, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = start + i
	}
	return out
}


func (b *Backend) devices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, b.state.PeersSnapshot())
}

func (b *Backend) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := b.state.Subscribe()
	defer b.state.Unsubscribe(ch)
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

func (b *Backend) transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "B-T000", "method not allowed")
		return
	}
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorJSON(w, http.StatusBadRequest, "B-T001", "invalid transfer request")
		return
	}
	if req.PeerID == "" || len(req.Files) == 0 {
		writeErrorJSON(w, http.StatusBadRequest, "B-T002", "missing peer or files")
		return
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":       req.TransferID,
		"peerId":   req.PeerID,
		"state":    "transferring",
		"direction": "outgoing",
		"files":    req.Files,
	}})
	if err := b.state.SendFiles(r.Context(), req); err != nil {
		b.state.publish(event{Type: "transfer", Data: map[string]any{
			"id":       req.TransferID,
			"peerId":   req.PeerID,
			"state":    "failed",
			"direction": "outgoing",
			"files":    req.Files,
			"errorMessage": err.Error(),
		}})
		writeErrorJSON(w, http.StatusBadGateway, "B-T010", "transfer to peer failed")
		return
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":       req.TransferID,
		"peerId":   req.PeerID,
		"state":    "completed",
		"direction": "outgoing",
		"files":    req.Files,
	}})
	writeJSON(w, map[string]any{"ok": true})
}

func (b *Backend) receive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "B-R000", "method not allowed")
		return
	}
	// Require a valid transfer token to prevent unsolicited uploads.
	token := r.Header.Get("X-Lanshare-Transfer-Token")
	if token == "" {
		writeErrorJSON(w, http.StatusUnauthorized, "B-R020", "missing transfer token")
		return
	}
	b.state.mu.Lock()
	at, ok := b.state.allowedTransferTokens[token]
	if !ok || time.Now().After(at.ExpiresAt) {
		b.state.mu.Unlock()
		writeErrorJSON(w, http.StatusForbidden, "B-R021", "invalid or expired transfer token")
		return
	}
	// token is valid for the expected transfer; consume it (single-use)
	delete(b.state.allowedTransferTokens, token)
	b.state.mu.Unlock()

	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		writeErrorJSON(w, http.StatusBadRequest, "B-R001", "expected multipart upload")
		return
	}
	reader := multipart.NewReader(r.Body, params["boundary"])
	metaPart, err := reader.NextPart()
	if err != nil {
		writeErrorJSON(w, http.StatusBadRequest, "B-R002", "missing metadata")
		return
	}
	if metaPart.FormName() != "metadata" {
		writeErrorJSON(w, http.StatusBadRequest, "B-R003", "missing metadata part")
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
	if err := json.NewDecoder(metaPart).Decode(&meta); err != nil {
		writeErrorJSON(w, http.StatusBadRequest, "B-R004", "invalid metadata")
		return
	}
	if len(meta.Files) == 0 {
		writeErrorJSON(w, http.StatusBadRequest, "B-R005", "missing files")
		return
	}
	uploaded := int64(0)
	total := int64(0)
	for _, file := range meta.Files {
		if !file.IsDir {
			total += file.Size
		}
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":               meta.TransferID,
		"peerId":           meta.PeerID,
		"deviceName":       meta.PeerName,
		"state":            "transferring",
		"direction":        "incoming",
		"files":            meta.Files,
		"bytesTransferred": uploaded,
		"totalSizeBytes":   total,
	}})
	downloads := defaultDownloads()
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		writeErrorJSON(w, http.StatusInternalServerError, "B-R006", "unable to prepare download folder")
		return
	}
	for idx, file := range meta.Files {
		if file.IsDir {
			targetDir, err := safeDownloadPath(downloads, file.RelativePath)
			if err != nil {
				writeErrorJSON(w, http.StatusBadRequest, "B-R007", "unsafe folder path rejected")
				return
			}
			if err := os.MkdirAll(targetDir, 0o755); err != nil {
				writeErrorJSON(w, http.StatusInternalServerError, "B-R008", "unable to create folder")
				return
			}
			continue
		}
		part, err := reader.NextPart()
		if err != nil {
			writeErrorJSON(w, http.StatusBadRequest, "B-R009", "missing file payload")
			return
		}
		expectedName := fmt.Sprintf("file-%d", idx)
		if part.FormName() != expectedName {
			writeErrorJSON(w, http.StatusBadRequest, "B-R010", "unexpected file order")
			return
		}
		targetPath, err := safeDownloadPath(downloads, file.RelativePath)
		if err != nil {
			writeErrorJSON(w, http.StatusBadRequest, "B-R011", "unsafe file path rejected")
			return
		}
		targetPath = getUniqueFilePath(targetPath)
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			writeErrorJSON(w, http.StatusInternalServerError, "B-R012", "unable to create parent folder")
			return
		}
		tmp := targetPath + ".part"
		dst, err := os.Create(tmp)
		if err != nil {
			writeErrorJSON(w, http.StatusInternalServerError, "B-R013", "unable to create destination file")
			return
		}
		hasher := sha256.New()
		multiWriter := io.MultiWriter(dst, hasher)
		written, copyErr := io.Copy(multiWriter, part)
		_ = dst.Close()
		if copyErr != nil {
			_ = os.Remove(tmp)
			b.state.publish(event{Type: "transfer", Data: map[string]any{
				"id":               meta.TransferID,
				"peerId":           meta.PeerID,
				"deviceName":       meta.PeerName,
				"state":            "failed",
				"direction":        "incoming",
				"files":            meta.Files,
				"errorMessage":     copyErr.Error(),
				"bytesTransferred": uploaded,
				"totalSizeBytes":   total,
			}})
			writeErrorJSON(w, http.StatusBadGateway, "B-R014", "file copy failed")
			return
		}
		computedChecksum := hex.EncodeToString(hasher.Sum(nil))
		if file.Checksum != "" && computedChecksum != file.Checksum {
			_ = os.Remove(tmp)
			b.state.publish(event{Type: "transfer", Data: map[string]any{
				"id":               meta.TransferID,
				"peerId":           meta.PeerID,
				"deviceName":       meta.PeerName,
				"state":            "failed",
				"direction":        "incoming",
				"files":            meta.Files,
				"errorMessage":     "checksum mismatch (corrupted download)",
				"bytesTransferred": uploaded,
				"totalSizeBytes":   total,
			}})
			writeErrorJSON(w, http.StatusBadRequest, "B-R016", "checksum mismatch (corrupted download)")
			return
		}
		uploaded += written
		b.state.publish(event{Type: "transfer", Data: map[string]any{
			"id":               meta.TransferID,
			"peerId":           meta.PeerID,
			"deviceName":       meta.PeerName,
			"state":            "transferring",
			"direction":        "incoming",
			"files":            meta.Files,
			"bytesTransferred": uploaded,
			"totalSizeBytes":   total,
		}})
		if err := os.Rename(tmp, targetPath); err != nil {
			_ = os.Remove(tmp)
			writeErrorJSON(w, http.StatusInternalServerError, "B-R015", "unable to finalize file")
			return
		}
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":               meta.TransferID,
		"peerId":           meta.PeerID,
		"deviceName":       meta.PeerName,
		"state":            "completed",
		"direction":        "incoming",
		"files":            meta.Files,
		"bytesTransferred": total,
		"totalSizeBytes":   total,
	}})
	writeJSON(w, map[string]any{"ok": true})
}

func (b *Backend) share(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	share, err := b.state.CreateShare(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, share)
}

func (b *Backend) serveShare(w http.ResponseWriter, r *http.Request) {
	b.state.ServeShare(w, r)
}

func defaultDownloads() string {
	if d, err := os.UserHomeDir(); err == nil && d != "" {
		return filepath.Join(d, "Downloads")
	}
	return "."
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErrorJSON(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      false,
		"code":    code,
		"message": message,
	})
}

func safeDownloadPath(baseDir, relativePath string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(relativePath))
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
	target := filepath.Join(baseDir, clean)
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	prefix := baseAbs + string(filepath.Separator)
	if targetAbs != baseAbs && !strings.HasPrefix(targetAbs, prefix) {
		return "", fmt.Errorf("unsafe path rejected")
	}
	return target, nil
}

func getUniqueFilePath(targetPath string) string {
	if _, err := os.Stat(targetPath); errors.Is(err, os.ErrNotExist) {
		return targetPath
	}
	dir := filepath.Dir(targetPath)
	ext := filepath.Ext(targetPath)
	base := strings.TrimSuffix(filepath.Base(targetPath), ext)

	for i := 1; i < 10000; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return targetPath
}