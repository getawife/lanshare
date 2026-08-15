package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"mime/multipart"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"strconv"
	"time"
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
	DeviceID   string
	DeviceName string
	Version    string
	HTTPPort   int
	LANPort    int
	Peers      map[string]Device
	events     map[chan event]struct{}
	mu         sync.Mutex
	shares     map[string]shareRecord
}

func NewServerState() (*ServerState, error) {
	name := "LANShare Desktop"
	if h, err := os.Hostname(); err == nil && h != "" {
		name = h
	}
	return &ServerState{
		DeviceID:   randomToken(8),
		DeviceName: name,
		Version:    "1.0.0",
		Peers:      map[string]Device{},
		events:     map[chan event]struct{}{},
		shares:     map[string]shareRecord{},
	}, nil
}

func (s *ServerState) Snapshot() AppState {
	s.mu.Lock()
	defer s.mu.Unlock()
	peers := make([]Device, 0, len(s.Peers))
	for _, p := range s.Peers {
		peers = append(peers, p)
	}
	return AppState{Device: s.selfDevice(), Port: s.LANPort, HTTPPort: s.HTTPPort, Peers: peers}
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
	addr := &net.UDPAddr{IP: net.IPv4bcast, Port: discoveryPort}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		payload, _ := json.Marshal(map[string]any{
			"id":          s.DeviceID,
			"name":        s.DeviceName,
			"os":          runtime.GOOS,
			"type":        deviceType(runtime.GOOS),
			"version":     s.Version,
			"port":        s.LANPort,
			"httpPort":    s.HTTPPort,
			"protocol":    1,
			"capabilities": []string{"files", "clipboard", "web"},
		})
		_, _ = conn.WriteTo(payload, addr)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
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
		ip := strings.Split(addr.String(), ":")[0]
		port := intFrom(packet["port"])
		httpPort := intFrom(packet["httpPort"])
		if httpPort == 0 {
			httpPort = port
		}
		if id == "" || id == s.DeviceID || (port == 0 && httpPort == 0) {
			continue
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
		}
		s.mu.Lock()
		s.Peers[id] = peer
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
			for id, peer := range s.Peers {
				if peer.Status != "offline" && time.Since(peer.LastSeen) > 12*time.Second {
					peer.Status = "offline"
					s.Peers[id] = peer
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
	peerPort := defaultLoopbackPeerPort
	if v := os.Getenv("LANSHARE_LOOPBACK_PEER_HTTP_PORT"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			peerPort = parsed
		}
	}
	if peerPort <= 0 {
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
		pr, pw := io.Pipe()
		mw := multipart.NewWriter(pw)
		targetPort := peer.HTTPPort
		if targetPort == 0 {
			targetPort = peer.Port
		}
		url := fmt.Sprintf("http://%s:%d/api/receive", peer.IP, targetPort)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, pr)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", mw.FormDataContentType())
	progressPath := func(done int64, total int64) {
		s.publish(event{Type: "transfer", Data: map[string]any{
			"id":             req.TransferID,
			"peerId":         req.PeerID,
			"deviceName":     peer.Name,
			"state":          "transferring",
			"direction":      "outgoing",
			"files":          req.Files,
			"bytesTransferred": done,
			"totalSizeBytes": total,
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
		return fmt.Errorf("peer rejected transfer: %s", resp.Status)
	}
	return nil
}

type expandedTransferFile struct {
	SourcePath   string
	RelativePath string
	IsDirectory  bool
	SizeBytes    int64
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
				out = append(out, expandedTransferFile{
					SourcePath:   path,
					RelativePath: rel,
					SizeBytes:    info.Size(),
				})
				return nil
			})
			if err != nil {
				return nil, err
			}
			continue
		}
		out = append(out, expandedTransferFile{
			SourcePath:   file.Path,
			RelativePath: file.Name,
			SizeBytes:    info.Size(),
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
	return s.Peers[id]
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
