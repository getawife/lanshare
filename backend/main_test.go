package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	state.update_settings(backend_settings{ask_before_accepting: false})

	req_body := `{"transferId":"tx-123","peerId":"peer-abc","deviceName":"Test Sender","files":[{"name":"test.txt","size":100}]}`
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
		device_name:          "My Custom Laptop",
		ask_before_accepting: true,
		download_folder:      "C:/Downloads",
	})

	if state.device_name != "My Custom Laptop" {
		t.Errorf("Expected state.device_name to be 'My Custom Laptop', got '%s'", state.device_name)
	}

	snap := state.snapshot()
	if snap.device.name != "My Custom Laptop" {
		t.Errorf("Expected snapshot device name to be 'My Custom Laptop', got '%s'", snap.device.name)
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