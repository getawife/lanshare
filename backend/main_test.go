package main

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func test_identity() device_identity {
	return device_identity{
		DeviceID:      "test-device-0000000000000000",
		ShortHash:     "test",
		SchemaVersion: 1,
	}
}

func test_state(t *testing.T) (*server_state, *backend) {
	t.Helper()
	state, err := new_server_state(test_identity(), "", map[string]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	return state, new_backend(state)
}

func TestSafeDownloadPath(t *testing.T) {
	temp_dir := t.TempDir()

	tests := []struct {
		name          string
		relative_path string
		want_err      bool
	}{
		{
			name:          "valid relative path",
			relative_path: "documents/report.pdf",
			want_err:      false,
		},
		{
			name:          "simple filename",
			relative_path: "photo.jpg",
			want_err:      false,
		},
		{
			name:          "directory traversal attempt",
			relative_path: "../secret.txt",
			want_err:      true,
		},
		{
			name:          "nested traversal attempt",
			relative_path: "foo/../../secret.txt",
			want_err:      true,
		},
		{
			name:          "windows drive specifier",
			relative_path: "C:/Windows/System32/cmd.exe",
			want_err:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := safe_download_path(temp_dir, tt.relative_path)
			if (err != nil) != tt.want_err {
				t.Errorf("safe_download_path() error = %v, wantErr %v", err, tt.want_err)
				return
			}
			if err == nil {
				base_abs, _ := filepath.Abs(temp_dir)
				target_abs, _ := filepath.Abs(got)
				prefix := base_abs + string(filepath.Separator)
				if target_abs != base_abs && !strings.HasPrefix(target_abs, prefix) {
					t.Errorf("safe_download_path() resulted in path %v outside base %v", target_abs, base_abs)
				}
			}
		})
	}
}

func TestGetUniqueFilePath(t *testing.T) {
	temp_dir := t.TempDir()
	file1 := filepath.Join(temp_dir, "test.txt")

	got1 := get_unique_file_path(file1)
	if got1 != file1 {
		t.Errorf("Expected %s, got %s", file1, got1)
	}

	if err := os.WriteFile(file1, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	got2 := get_unique_file_path(file1)
	expected2 := filepath.Join(temp_dir, "test (1).txt")
	if got2 != expected2 {
		t.Errorf("Expected %s, got %s", expected2, got2)
	}

	if err := os.WriteFile(expected2, []byte("hello 2"), 0o644); err != nil {
		t.Fatal(err)
	}

	got3 := get_unique_file_path(file1)
	expected3 := filepath.Join(temp_dir, "test (2).txt")
	if got3 != expected3 {
		t.Errorf("Expected %s, got %s", expected3, got3)
	}
}

func TestComputeFileSHA256(t *testing.T) {
	temp_dir := t.TempDir()
	file_path := filepath.Join(temp_dir, "sample.txt")

	content := []byte("hello lanshare")
	if err := os.WriteFile(file_path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	hash, err := compute_file_sha256(file_path)
	if err != nil {
		t.Fatalf("compute_file_sha256 failed: %v", err)
	}
	if len(hash) != 64 {
		t.Errorf("Expected 64 hex characters, got %d (%s)", len(hash), hash)
	}

	empty_file := filepath.Join(temp_dir, "empty.txt")
	if err := os.WriteFile(empty_file, []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	empty_hash, err := compute_file_sha256(empty_file)
	if err != nil {
		t.Fatalf("compute_file_sha256 empty file failed: %v", err)
	}
	expected_empty := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if empty_hash != expected_empty {
		t.Errorf("Expected empty file hash %s, got %s", expected_empty, empty_hash)
	}
}

func TestGetBroadcastAddresses(t *testing.T) {
	addrs := get_broadcast_addresses(43821)
	if len(addrs) == 0 {
		t.Fatal("Expected at least 1 broadcast address (255.255.255.255), got 0")
	}
	first_ip := addrs[0].IP.String()
	if first_ip != "255.255.255.255" {
		t.Errorf("Expected first broadcast IP to be 255.255.255.255, got %s", first_ip)
	}
}

func TestPrepareTransferAutoAccept(t *testing.T) {
	state, backend := test_state(t)
	state.update_settings(backend_settings{AskBeforeAccepting: false})

	req_body := `{"transferId":"tx-123","peerId":"peer-abc","deviceName":"Test Sender","files":[{"relativePath":"test.txt","size":100,"checksum":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/prepare-transfer", strings.NewReader(req_body))
	rec := httptest.NewRecorder()

	backend.prepare_transfer(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var res struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if !res.OK || res.Token == "" {
		t.Fatalf("Expected valid token in response, got %+v", res)
	}

	state.mu.Lock()
	_, ok := state.allowed_transfer_tokens[res.Token]
	state.mu.Unlock()
	if !ok {
		t.Fatalf("Expected token %s to be registered in allowed_transfer_tokens", res.Token)
	}
}

func TestReceiveTokenValidation(t *testing.T) {
	_, backend := test_state(t)

	req := httptest.NewRequest(http.MethodPost, "/api/receive", nil)
	rec := httptest.NewRecorder()
	backend.receive(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 for missing token, got %d", rec.Code)
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/receive", nil)
	req2.Header.Set("X-Lanshare-Transfer-Token", "invalid-token")
	rec2 := httptest.NewRecorder()
	backend.receive(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Errorf("Expected 403 for invalid token, got %d", rec2.Code)
	}
}

func TestUpdateSettingsDeviceName(t *testing.T) {
	state, _ := test_state(t)

	state.update_settings(backend_settings{
		DeviceName:         "My Custom Laptop",
		AskBeforeAccepting: true,
		DownloadFolder:     "C:/Downloads",
	})

	if state.device_name != "My Custom Laptop" {
		t.Errorf("Expected state.device_name to be 'My Custom Laptop', got '%s'", state.device_name)
	}

	snap := state.snapshot()
	if snap.Device.Name != "My Custom Laptop" {
		t.Errorf("Expected snapshot device name to be 'My Custom Laptop', got '%s'", snap.Device.Name)
	}
}

func TestIsAllowedOrigin(t *testing.T) {
	tests := []struct {
		origin  string
		allowed bool
	}{
		{"http://127.0.0.1:5173", true},
		{"http://localhost:5173", true},
		{"http://127.0.0.1:5174", true},
		{"http://localhost:3000", true},
		{"null", true},
		{"http://evil.com", false},
		{"http://192.168.1.50:5173", false},
		{"invalid-url", false},
	}

	for _, tt := range tests {
		got := is_allowed_origin(tt.origin)
		if got != tt.allowed {
			t.Errorf("is_allowed_origin(%q) = %v, want %v", tt.origin, got, tt.allowed)
		}
	}
}

func TestUIGuard(t *testing.T) {
	state, backend := test_state(t)
	state.admin_token = "secret"
	handler := backend.ui_server.Handler
	do := func(host string, origin string, token string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		req.Host = host
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if token != "" {
			req.Header.Set("X-Lanshare-Token", token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := do("127.0.0.1:1", "", ""); got != http.StatusUnauthorized {
		t.Errorf("no token: got %d", got)
	}
	if got := do("127.0.0.1:1", "", "wrong"); got != http.StatusUnauthorized {
		t.Errorf("wrong token: got %d", got)
	}
	if got := do("127.0.0.1:1", "", "secret"); got != http.StatusOK {
		t.Errorf("valid token: got %d", got)
	}
	if got := do("evil.example:1", "", "secret"); got != http.StatusForbidden {
		t.Errorf("bad host: got %d", got)
	}
	if got := do("127.0.0.1:1", "http://evil.com", "secret"); got != http.StatusForbidden {
		t.Errorf("bad origin: got %d", got)
	}
}

func TestSharePassword(t *testing.T) {
	state, _ := test_state(t)
	path := filepath.Join(t.TempDir(), "s.txt")
	if err := os.WriteFile(path, []byte("secret data"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := state.create_share(share_request{Files: []string{path}, Password: "pw"})
	if err != nil {
		t.Fatal(err)
	}
	url := "/s/" + res["token"].(string)
	rec := httptest.NewRecorder()
	state.serve_share(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no password: got %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.SetBasicAuth("", "pw")
	rec = httptest.NewRecorder()
	state.serve_share(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "secret data" {
		t.Errorf("correct password: got %d %q", rec.Code, rec.Body.String())
	}
	if _, err := state.create_share(share_request{Files: []string{t.TempDir()}}); err == nil {
		t.Error("expected directory share to be rejected")
	}
}

func TestPinnedTLSTransfer(t *testing.T) {
	recv_state, recv_backend := test_state(t)
	downloads := t.TempDir()
	recv_state.update_settings(backend_settings{AskBeforeAccepting: false, DownloadFolder: downloads})
	srv := httptest.NewUnstartedServer(recv_backend.lan_server.Handler)
	srv.TLS = recv_state.tls_config()
	srv.StartTLS()
	defer srv.Close()
	host, port_text, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "https://"))
	port, _ := strconv.Atoi(port_text)

	send_state, _ := test_state(t)
	src := t.TempDir()
	if err := os.MkdirAll(filepath.Join(src, "dir", "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "dir", "sub", "b.txt"), []byte("world"), 0o644); err != nil {
		t.Fatal(err)
	}
	req := transfer_request{
		TransferID: "t1",
		PeerID:     "r",
		Files: []file_item{
			{Path: filepath.Join(src, "a.txt"), Name: "a.txt", Size: 5},
			{Path: filepath.Join(src, "dir"), Name: "dir", IsDir: true},
		},
	}

	send_state.peers["r"] = device{ID: "r", IP: host, HTTPPort: port, CertFP: "00"}
	if err := send_state.send_files(context.Background(), req); err == nil {
		t.Fatal("expected failure when certificate fingerprint does not match")
	}

	send_state.peers["r"] = device{ID: "r", IP: host, HTTPPort: port, CertFP: recv_state.cert_fp}
	if err := send_state.send_files(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", filepath.Join("dir", "sub", "b.txt")} {
		if _, err := os.Stat(filepath.Join(downloads, name)); err != nil {
			t.Errorf("missing %s: %v", name, err)
		}
	}
}

func TestCancelTransfer(t *testing.T) {
	recv_state, recv_backend := test_state(t)
	srv := httptest.NewUnstartedServer(recv_backend.lan_server.Handler)
	srv.TLS = recv_state.tls_config()
	srv.StartTLS()
	defer srv.Close()
	host, port_text, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "https://"))
	port, _ := strconv.Atoi(port_text)

	send_state, send_backend := test_state(t)
	send_state.peers["r"] = device{ID: "r", IP: host, HTTPPort: port, CertFP: recv_state.cert_fp}
	src := filepath.Join(t.TempDir(), "a.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(transfer_request{
		TransferID: "t1",
		PeerID:     "r",
		Files:      []file_item{{Path: src, Name: "a.txt", Size: 5}},
	})

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := httptest.NewRecorder()
		send_backend.transfer(rec, httptest.NewRequest(http.MethodPost, "/api/transfer", strings.NewReader(string(body))))
		done <- rec
	}()

	pending_count := func() int {
		recv_state.mu.Lock()
		defer recv_state.mu.Unlock()
		return len(recv_state.pending_transfers)
	}
	wait_for := func(want int) bool {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if pending_count() == want {
				return true
			}
			time.Sleep(10 * time.Millisecond)
		}
		return false
	}
	if !wait_for(1) {
		t.Fatal("receiver never saw the pending transfer")
	}

	cancel := func() int {
		rec := httptest.NewRecorder()
		send_backend.cancel_transfer(rec, httptest.NewRequest(http.MethodPost, "/api/cancel-transfer", strings.NewReader(`{"transferId":"t1"}`)))
		return rec.Code
	}
	if code := cancel(); code != http.StatusOK {
		t.Fatalf("cancel returned %d", code)
	}
	select {
	case rec := <-done:
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "B-T011") {
			t.Fatalf("expected cancelled response, got %d %s", rec.Code, rec.Body.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("transfer handler did not return after cancel")
	}
	if !wait_for(0) {
		t.Error("receiver still has a pending transfer after cancel")
	}
	if code := cancel(); code != http.StatusNotFound {
		t.Errorf("second cancel returned %d, want 404", code)
	}
}

func TestSanitizeComponent(t *testing.T) {
	long := strings.Repeat("a", 300) + ".txt"
	tests := []struct {
		name    string
		in      string
		windows bool
		want    string
	}{
		{"windows illegal characters", `report: final?.txt`, true, "report_ final_.txt"},
		{"windows reserved name", "CON.txt", true, "_CON.txt"},
		{"windows reserved with spaces", "nul .log", true, "_nul .log"},
		{"windows com port", "com3", true, "_com3"},
		{"windows com10 is allowed", "COM10.txt", true, "COM10.txt"},
		{"windows trailing dot and space", "notes. .", true, "notes"},
		{"windows backslash", `a\b.txt`, true, "a_b.txt"},
		{"windows drive prefix", "C:", true, "C_"},
		{"windows only dots", "...", true, "_"},
		{"control characters", "a\x00b\x1f.txt", false, "a_b_.txt"},
		{"unix keeps colon and question mark", "a:b?.txt", false, "a:b?.txt"},
		{"unix keeps trailing dot", "notes.", false, "notes."},
		{"unix keeps reserved name", "CON.txt", false, "CON.txt"},
		{"dot dot untouched", "..", true, ".."},
		{"empty becomes underscore", "", false, "_"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitize_component(tt.in, tt.windows); got != tt.want {
				t.Errorf("sanitize_component(%q, %v) = %q, want %q", tt.in, tt.windows, got, tt.want)
			}
		})
	}
	got := sanitize_component(long, false)
	if len(got) != max_component_bytes || !strings.HasSuffix(got, ".txt") {
		t.Errorf("long name not truncated correctly: len=%d suffix=%q", len(got), got[len(got)-4:])
	}
	multibyte := strings.Repeat("é", 200) + ".pdf"
	got = sanitize_component(multibyte, false)
	if len(got) > max_component_bytes || !strings.HasSuffix(got, ".pdf") || !utf8.ValidString(got) {
		t.Errorf("multibyte name truncated badly: len=%d valid=%v", len(got), utf8.ValidString(got))
	}
}

func TestSanitizeRelativePath(t *testing.T) {
	tests := []struct {
		in      string
		windows bool
		want    string
	}{
		{"photos/trip: day 1/IMG?.jpg", true, "photos/trip_ day 1/IMG_.jpg"},
		{"photos/trip: day 1/IMG?.jpg", false, "photos/trip: day 1/IMG?.jpg"},
		{"a//b/./c.txt", false, "a/b/c.txt"},
		{"../x.txt", true, "../x.txt"},
		{"aux/prn/file.txt", true, "_aux/_prn/file.txt"},
		{"", true, ""},
	}
	for _, tt := range tests {
		if got := sanitize_relative_path(tt.in, tt.windows); got != tt.want {
			t.Errorf("sanitize_relative_path(%q, %v) = %q, want %q", tt.in, tt.windows, got, tt.want)
		}
	}
}

func TestReceiveSanitizesNames(t *testing.T) {
	recv_state, recv_backend := test_state(t)
	downloads := t.TempDir()
	recv_state.update_settings(backend_settings{AskBeforeAccepting: false, DownloadFolder: downloads})
	srv := httptest.NewUnstartedServer(recv_backend.lan_server.Handler)
	srv.TLS = recv_state.tls_config()
	srv.StartTLS()
	defer srv.Close()
	host, port_text, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "https://"))
	port, _ := strconv.Atoi(port_text)

	send_state, _ := test_state(t)
	send_state.peers["r"] = device{ID: "r", IP: host, HTTPPort: port, CertFP: recv_state.cert_fp}
	src := t.TempDir()
	bad := "weird\x01name.txt"
	if err := os.WriteFile(filepath.Join(src, bad), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	req := transfer_request{
		TransferID: "s1",
		PeerID:     "r",
		Files:      []file_item{{Path: filepath.Join(src, bad), Name: bad, Size: 4}},
	}
	if err := send_state.send_files(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(downloads, "weird_name.txt")); err != nil {
		entries, _ := os.ReadDir(downloads)
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("sanitised file missing: %v (found %v)", err, names)
	}
}

const hello_sha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

func prepare_for(t *testing.T, backend *backend, files string) string {
	t.Helper()
	body := `{"transferId":"t1","peerId":"p","deviceName":"n","files":` + files + `}`
	rec := httptest.NewRecorder()
	backend.prepare_transfer(rec, httptest.NewRequest(http.MethodPost, "/api/prepare-transfer", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("prepare failed: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res.Token
}

func upload(t *testing.T, backend *backend, token string, files string, payload string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	meta, _ := mw.CreateFormField("metadata")
	_, _ = meta.Write([]byte(`{"transferId":"t1","peerId":"p","deviceName":"n","files":` + files + `}`))
	part, _ := mw.CreateFormField("file-0")
	_, _ = part.Write([]byte(payload))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/receive", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Lanshare-Transfer-Token", token)
	rec := httptest.NewRecorder()
	backend.receive(rec, req)
	return rec
}

func dir_names(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestReceiveBoundToApprovedManifest(t *testing.T) {
	state, backend := test_state(t)
	downloads := t.TempDir()
	state.update_settings(backend_settings{AskBeforeAccepting: false, DownloadFolder: downloads})
	approved := `[{"relativePath":"a.txt","isDir":false,"size":5,"checksum":"` + hello_sha256 + `"}]`

	token := prepare_for(t, backend, approved)
	swapped := `[{"relativePath":"evil.txt","isDir":false,"size":5,"checksum":"` + hello_sha256 + `"}]`
	rec := upload(t, backend, token, swapped, "hello")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "B-R022") {
		t.Fatalf("renamed file should be rejected: %d %s", rec.Code, rec.Body.String())
	}

	token = prepare_for(t, backend, approved)
	extra := `[{"relativePath":"a.txt","isDir":false,"size":5,"checksum":"` + hello_sha256 + `"},{"relativePath":"b.txt","isDir":false,"size":5,"checksum":"` + hello_sha256 + `"}]`
	if rec := upload(t, backend, token, extra, "hello"); rec.Code != http.StatusForbidden {
		t.Fatalf("extra file should be rejected: %d", rec.Code)
	}
	if names := dir_names(t, downloads); len(names) != 0 {
		t.Fatalf("nothing should be written for rejected transfers, found %v", names)
	}

	token = prepare_for(t, backend, approved)
	if rec := upload(t, backend, token, approved, "hello world, much longer than approved"); rec.Code == http.StatusOK {
		t.Fatal("oversized payload should be rejected")
	}
	if names := dir_names(t, downloads); len(names) != 0 {
		t.Fatalf("oversized upload must leave nothing behind, found %v", names)
	}

	token = prepare_for(t, backend, approved)
	if rec := upload(t, backend, token, approved, "hello"); rec.Code != http.StatusOK {
		t.Fatalf("approved transfer should succeed: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(downloads, "a.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestReceiveRejectsDifferentSenderCertificate(t *testing.T) {
	state, backend := test_state(t)
	state.update_settings(backend_settings{AskBeforeAccepting: false, DownloadFolder: t.TempDir()})
	approved := `[{"relativePath":"a.txt","isDir":false,"size":5,"checksum":"` + hello_sha256 + `"}]`
	token := prepare_for(t, backend, approved)
	state.mu.Lock()
	at := state.allowed_transfer_tokens[token]
	at.sender_fp = "aa"
	state.allowed_transfer_tokens[token] = at
	state.mu.Unlock()
	rec := upload(t, backend, token, approved, "hello")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "B-R023") {
		t.Fatalf("expected B-R023, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPrepareValidation(t *testing.T) {
	_, backend := test_state(t)
	post := func(files string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		backend.prepare_transfer(rec, httptest.NewRequest(http.MethodPost, "/api/prepare-transfer", strings.NewReader(`{"transferId":"x","peerId":"p","files":`+files+`}`)))
		return rec
	}
	if rec := post(`[{"relativePath":"a.txt","size":5}]`); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "B-P005") {
		t.Errorf("missing checksum: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post(`[{"relativePath":"a.txt","size":-1,"checksum":"` + hello_sha256 + `"}]`); rec.Code != http.StatusBadRequest {
		t.Errorf("negative size: %d", rec.Code)
	}
	if rec := post(`[{"relativePath":"","size":1,"checksum":"` + hello_sha256 + `"}]`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty path: %d", rec.Code)
	}
	many := make([]file_item, max_files_per_transfer+1)
	for i := range many {
		many[i] = file_item{RelativePath: "a", Size: 1, Checksum: hello_sha256}
	}
	if err := validate_prepare_files(many); err == nil {
		t.Error("expected too many files to be rejected")
	}
}

func TestPrepareRateLimit(t *testing.T) {
	_, backend := test_state(t)
	last := 0
	for i := 0; i < prepare_rate_limit+2; i++ {
		rec := httptest.NewRecorder()
		backend.prepare_transfer(rec, httptest.NewRequest(http.MethodPost, "/api/prepare-transfer", strings.NewReader(`{}`)))
		last = rec.Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("expected 429 after limit, got %d", last)
	}
}

func TestRateLimiter(t *testing.T) {
	l := new_rate_limiter()
	for i := 0; i < 3; i++ {
		if !l.allow("a", 3, time.Minute) {
			t.Fatalf("hit %d should be allowed", i)
		}
	}
	if l.allow("a", 3, time.Minute) {
		t.Error("fourth hit should be blocked")
	}
	if !l.allow("b", 3, time.Minute) {
		t.Error("other keys are independent")
	}
	if l.exceeded("c", 1, time.Minute) {
		t.Error("untouched key is not exceeded")
	}
	l.hit("c")
	if !l.exceeded("c", 1, time.Minute) {
		t.Error("key should be exceeded after a hit")
	}
}

func TestSymlinkEscapeRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	base := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(base, "evil")); err != nil {
		t.Fatal(err)
	}
	if _, err := safe_download_path(base, "evil/x.txt"); err == nil {
		t.Error("path through a symlink out of the download folder must be rejected")
	}
	if _, err := safe_download_path(base, "fine/x.txt"); err != nil {
		t.Errorf("ordinary nested path should be allowed: %v", err)
	}
}

func TestSenderSkipsSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	state, _ := test_state(t)
	dir := t.TempDir()
	secret := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "real.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "link.txt")); err != nil {
		t.Fatal(err)
	}
	manifest, err := state.expand_transfer_files([]file_item{{Path: dir, IsDir: true}})
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range manifest {
		if strings.Contains(entry.relative_path, "link.txt") {
			t.Errorf("symlink must not be sent: %s", entry.relative_path)
		}
	}
	if len(manifest) != 2 {
		t.Errorf("expected folder plus real.txt, got %d entries", len(manifest))
	}
}

func TestShareLockout(t *testing.T) {
	share_failure_delay = 0
	defer func() { share_failure_delay = time.Second }()
	state, _ := test_state(t)
	path := filepath.Join(t.TempDir(), "s.txt")
	if err := os.WriteFile(path, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := state.create_share(share_request{Files: []string{path}, Password: "pw"})
	if err != nil {
		t.Fatal(err)
	}
	url := "/s/" + res["token"].(string)
	for i := 0; i < share_failure_limit; i++ {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.SetBasicAuth("", "wrong")
		rec := httptest.NewRecorder()
		state.serve_share(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.SetBasicAuth("", "pw")
	rec := httptest.NewRecorder()
	state.serve_share(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("locked out client should get 429, got %d", rec.Code)
	}
}

func TestDiscoveryHardening(t *testing.T) {
	state, _ := test_state(t)
	announce := func(id string, fp string, name string, ip string) {
		state.handle_announcement(map[string]any{"id": id, "name": name, "port": 1.0, "httpPort": 2.0, "os": "linux", "certFp": fp}, ip)
	}
	announce("p1", "aa", "Mac", "10.0.0.2")
	announce("p1", "bb", "Mac", "10.0.0.9")
	if got := state.find_peer("p1").CertFP; got != "aa" {
		t.Fatalf("an online peer must not be displaced by a different certificate, got %q", got)
	}
	state.mu.Lock()
	_, warned := state.security_warned["conflict:p1"]
	peer := state.peers["p1"]
	peer.Status = "offline"
	state.peers["p1"] = peer
	state.mu.Unlock()
	if !warned {
		t.Error("a certificate conflict should raise a warning")
	}
	announce("p1", "bb", "Mac", "10.0.0.9")
	if got := state.find_peer("p1").CertFP; got != "bb" {
		t.Errorf("after the original went offline the new certificate is accepted, got %q", got)
	}
	state.mu.Lock()
	_, changed := state.security_warned["changed:p1"]
	state.mu.Unlock()
	if !changed {
		t.Error("accepting a changed certificate should raise a warning")
	}

	for i := 0; i < max_known_peers+50; i++ {
		announce("flood-"+strconv.Itoa(i), "cc", "x", "10.0.1.1")
	}
	state.mu.Lock()
	count := len(state.peers)
	state.mu.Unlock()
	if count > max_known_peers {
		t.Errorf("peer list grew past the cap: %d", count)
	}

	announce("named", "dd", "Evil\x00\x1b[31m"+strings.Repeat("A", 200), "10.0.0.5")
	name := state.find_peer("named").Name
	if len([]rune(name)) > max_peer_name_runes || strings.ContainsAny(name, "\x00\x1b") {
		t.Errorf("peer name not sanitised: %q", name)
	}
}

func TestUnverifiedSenderIsLabelled(t *testing.T) {
	state, backend := test_state(t)
	events := state.subscribe()
	ctx, cancel := context.WithCancel(context.Background())
	body := `{"transferId":"t9","peerId":"someone","deviceName":"Mom Laptop","files":[{"relativePath":"a.txt","size":5,"checksum":"` + hello_sha256 + `"}]}`
	done := make(chan struct{})
	go func() {
		backend.prepare_transfer(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/prepare-transfer", strings.NewReader(body)).WithContext(ctx))
		close(done)
	}()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case evt := <-events:
			if evt.Type != "incoming-transfer-request" {
				continue
			}
			data := evt.Data.(map[string]any)
			if name, _ := data["deviceName"].(string); !strings.HasSuffix(name, "(unverified)") {
				t.Errorf("unverified sender must be labelled, got %q", name)
			}
			if verified, _ := data["verified"].(bool); verified {
				t.Error("sender without a matching certificate must not be verified")
			}
			cancel()
			<-done
			return
		case <-deadline:
			cancel()
			t.Fatal("no incoming request event")
		}
	}
}

func TestFreeDiskBytes(t *testing.T) {
	free, err := free_disk_bytes(t.TempDir())
	if err != nil || free == 0 {
		t.Errorf("free_disk_bytes = %d, %v", free, err)
	}
}

func TestValidateDownloadFolder(t *testing.T) {
	if err := validate_download_folder("relative/path"); err == nil {
		t.Error("relative paths must be rejected")
	}
	if err := validate_download_folder(t.TempDir()); err != nil {
		t.Errorf("absolute path should be accepted: %v", err)
	}
	if err := validate_download_folder(string(filepath.Separator)); err == nil {
		t.Error("filesystem root must be rejected")
	}
}
