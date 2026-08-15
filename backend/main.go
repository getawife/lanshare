package main

import (
	"context"
	"crypto/rand"
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
	"strconv"
	"runtime"
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
	mux.HandleFunc("/api/receive", b.receive)
	mux.HandleFunc("/api/share", b.share)
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
	httpLn, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", httpPort))
	if err != nil {
		return err
	}
	b.state.HTTPPort = httpLn.Addr().(*net.TCPAddr).Port

	lanLn, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", discoveryPort))
	if err != nil {
		lanLn, err = net.ListenPacket("udp4", ":0")
		if err != nil {
			return err
		}
	}
	b.state.LANPort = lanLn.LocalAddr().(*net.UDPAddr).Port

	go b.state.RunDiscovery(ctx, lanLn)
	go b.state.RunExpiredPeerSweep(ctx)
	go b.state.RunLoopbackPeerProbe(ctx)

	log.Printf("LANShare backend ready: http=127.0.0.1:%d lan=%d", b.state.HTTPPort, b.state.LANPort)

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
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Lanshare-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (b *Backend) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true, "platform": runtime.GOOS})
}

func (b *Backend) stateHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, b.state.Snapshot())
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
		written, copyErr := io.Copy(dst, part)
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
