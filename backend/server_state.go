package main

import (
	"context"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
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
		OS:           runtime.GOOS,
		Type:         deviceType(runtime.GOOS),
		IP:           "127.0.0.1",
		Port:         s.LANPort,
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
		if id == "" || id == s.DeviceID || port == 0 {
			continue
		}
		peer := Device{
			ID:           id,
			Name:         name,
			OS:           stringFrom(packet["os"]),
			Type:         stringFrom(packet["type"]),
			IP:           ip,
			Port:         port,
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
			for id, peer := range s.Peers {
				if time.Since(peer.LastSeen) > 12*time.Second {
					peer.Status = "offline"
					s.Peers[id] = peer
				}
			}
			s.mu.Unlock()
		}
	}
}

func (s *ServerState) SendFiles(ctx context.Context, req TransferRequest) error {
	peer := s.findPeer(req.PeerID)
	if peer.ID == "" {
		return fmt.Errorf("peer not found")
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://%s:%d/api/receive", peer.IP, peer.Port)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	httpReq.Header.Set("Content-Type", "application/json")
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
	case "darwin":
		return "mac"
	case "windows", "linux":
		return "pc"
	default:
		return "phone"
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
