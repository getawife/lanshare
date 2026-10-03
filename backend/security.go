package main

import (
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	max_files_per_transfer = 10000
	max_pending_transfers  = 8
	max_known_peers        = 256
	max_peer_name_runes    = 64
	max_relative_path_len  = 4096
	disk_headroom_bytes    = 64 << 20
	prepare_rate_limit     = 30
	share_failure_limit    = 5
	share_failure_window   = 5 * time.Minute
	warning_cooldown       = time.Minute
)

var share_failure_delay = time.Second

var checksum_pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type approved_file struct {
	RelativePath string
	IsDir        bool
	Size         int64
	Checksum     string
}

type rate_limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func new_rate_limiter() *rate_limiter {
	return &rate_limiter{hits: map[string][]time.Time{}}
}

func (l *rate_limiter) recent(key string, window time.Duration, now time.Time) []time.Time {
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < window {
			kept = append(kept, t)
		}
	}
	return kept
}

func (l *rate_limiter) sweep(now time.Time) {
	for key, hits := range l.hits {
		if len(hits) == 0 || now.Sub(hits[len(hits)-1]) > 10*time.Minute {
			delete(l.hits, key)
		}
	}
}

func (l *rate_limiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	recent := l.recent(key, window, now)
	if len(recent) >= limit {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	if len(l.hits) > 4096 {
		l.sweep(now)
	}
	return true
}

func (l *rate_limiter) exceeded(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.recent(key, window, time.Now())
	l.hits[key] = recent
	return len(recent) >= limit
}

func (l *rate_limiter) hit(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.hits[key] = append(l.hits[key], now)
	if len(l.hits) > 4096 {
		l.sweep(now)
	}
}

func remote_ip(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func clean_peer_name(name string) string {
	var b strings.Builder
	count := 0
	for _, r := range strings.TrimSpace(name) {
		if unicode.IsControl(r) || r == unicode.ReplacementChar {
			continue
		}
		if count >= max_peer_name_runes {
			break
		}
		b.WriteRune(r)
		count++
	}
	return strings.TrimSpace(b.String())
}

func manifest_from_files(files []file_item) []approved_file {
	out := make([]approved_file, 0, len(files))
	for _, f := range files {
		out = append(out, approved_file{
			RelativePath: f.RelativePath,
			IsDir:        f.IsDir,
			Size:         f.Size,
			Checksum:     strings.ToLower(f.Checksum),
		})
	}
	return out
}

func manifest_matches(approved []approved_file, got []approved_file) bool {
	if len(approved) != len(got) {
		return false
	}
	for i := range approved {
		if approved[i] != got[i] {
			return false
		}
	}
	return true
}

func validate_prepare_files(files []file_item) error {
	if len(files) > max_files_per_transfer {
		return errors.New("too many files in one transfer")
	}
	for _, f := range files {
		if f.RelativePath == "" || len(f.RelativePath) > max_relative_path_len {
			return errors.New("invalid file path")
		}
		if f.Size < 0 {
			return errors.New("invalid file size")
		}
		if !f.IsDir && !checksum_pattern.MatchString(strings.ToLower(f.Checksum)) {
			return errors.New("missing or invalid file checksum")
		}
	}
	return nil
}

func validate_download_folder(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("download folder must be an absolute path")
	}
	if filepath.Dir(path) == path {
		return errors.New("download folder cannot be a filesystem root")
	}
	return nil
}

func ensure_no_symlink_escape(base string, target string) error {
	real_base, err := filepath.EvalSymlinks(base)
	if err != nil {
		return err
	}
	probe := target
	for {
		if _, err := os.Lstat(probe); err == nil {
			break
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return errors.New("path escapes download folder")
		}
		probe = parent
	}
	real_probe, err := filepath.EvalSymlinks(probe)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(real_base, real_probe)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("path escapes download folder")
	}
	return nil
}

func (s *server_state) security_warning(key string, kind string, peer_id string, name string, message string) {
	s.mu.Lock()
	last, seen := s.security_warned[key]
	if seen && time.Since(last) < warning_cooldown {
		s.mu.Unlock()
		return
	}
	s.security_warned[key] = time.Now()
	s.mu.Unlock()
	s.publish(event{Type: "security-warning", Data: map[string]any{
		"kind":       kind,
		"peerId":     peer_id,
		"deviceName": name,
		"message":    message,
	}})
}