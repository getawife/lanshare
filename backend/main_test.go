package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeDownloadPath(t *testing.T) {
	tempDir := t.TempDir()

	tests := []struct {
		name         string
		relativePath string
		wantErr      bool
	}{
		{
			name:         "valid relative path",
			relativePath: "documents/report.pdf",
			wantErr:      false,
		},
		{
			name:         "simple filename",
			relativePath: "photo.jpg",
			wantErr:      false,
		},
		{
			name:         "directory traversal attempt",
			relativePath: "../secret.txt",
			wantErr:      true,
		},
		{
			name:         "nested traversal attempt",
			relativePath: "foo/../../secret.txt",
			wantErr:      true,
		},
		{
			name:         "windows drive specifier",
			relativePath: "C:/Windows/System32/cmd.exe",
			wantErr:      false, // Sanitizes to System32/cmd.exe under tempDir
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := safeDownloadPath(tempDir, tt.relativePath)
			if (err != nil) != tt.wantErr {
				t.Errorf("safeDownloadPath() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err == nil {
				baseAbs, _ := filepath.Abs(tempDir)
				targetAbs, _ := filepath.Abs(got)
				prefix := baseAbs + string(filepath.Separator)
				if targetAbs != baseAbs && !strings.HasPrefix(targetAbs, prefix) {
					t.Errorf("safeDownloadPath() resulted in path %v outside base %v", targetAbs, baseAbs)
				}
			}
		})
	}
}

func TestGetUniqueFilePath(t *testing.T) {
	tempDir := t.TempDir()
	file1 := filepath.Join(tempDir, "test.txt")

	// First call when file does not exist should return file1
	got1 := getUniqueFilePath(file1)
	if got1 != file1 {
		t.Errorf("Expected %s, got %s", file1, got1)
	}

	// Create file1
	if err := os.WriteFile(file1, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Second call should return test (1).txt
	got2 := getUniqueFilePath(file1)
	expected2 := filepath.Join(tempDir, "test (1).txt")
	if got2 != expected2 {
		t.Errorf("Expected %s, got %s", expected2, got2)
	}

	// Create expected2
	if err := os.WriteFile(expected2, []byte("hello 2"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Third call should return test (2).txt
	got3 := getUniqueFilePath(file1)
	expected3 := filepath.Join(tempDir, "test (2).txt")
	if got3 != expected3 {
		t.Errorf("Expected %s, got %s", expected3, got3)
	}
}
