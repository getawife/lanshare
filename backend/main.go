package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"io"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

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
	httpLn, err := net.Listen("tcp", "127.0.0.1:43821")
	if err != nil {
		return err
	}
	b.state.HTTPPort = httpLn.Addr().(*net.TCPAddr).Port

	lanLn, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		return err
	}
	b.state.LANPort = lanLn.LocalAddr().(*net.UDPAddr).Port

	go b.state.RunDiscovery(ctx, lanLn)
	go b.state.RunExpiredPeerSweep(ctx)

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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.PeerID == "" || len(req.Files) == 0 {
		http.Error(w, "missing peerId or files", http.StatusBadRequest)
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
		http.Error(w, err.Error(), http.StatusBadGateway)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(req.Files) == 0 {
		http.Error(w, "missing files", http.StatusBadRequest)
		return
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":       req.TransferID,
		"state":    "transferring",
		"direction": "incoming",
		"files":    req.Files,
	}})
	downloads := defaultDownloads()
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, file := range req.Files {
		if file.IsDir {
			continue
		}
		src, err := os.Open(file.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer src.Close()
		dstPath := filepath.Join(downloads, filepath.Base(file.Name))
		tmp := dstPath + ".part"
		dst, err := os.Create(tmp)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			_ = os.Remove(tmp)
			b.state.publish(event{Type: "transfer", Data: map[string]any{
				"id":       req.TransferID,
				"state":    "failed",
				"direction": "incoming",
				"files":    req.Files,
				"errorMessage": err.Error(),
			}})
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		_ = dst.Close()
		_ = os.Rename(tmp, dstPath)
	}
	b.state.publish(event{Type: "transfer", Data: map[string]any{
		"id":       req.TransferID,
		"state":    "completed",
		"direction": "incoming",
		"files":    req.Files,
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
