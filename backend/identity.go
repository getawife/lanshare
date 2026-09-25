package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type device_identity struct {
	DeviceID      string    `json:"deviceId"`
	ShortHash     string    `json:"shortHash"`
	CreatedAt     time.Time `json:"createdAt"`
	SchemaVersion int       `json:"schemaVersion"`
}

const identity_schema_version = 1
const identity_filename = "device.json"

func load_or_create_identity(user_data_dir string) (device_identity, error) {
	if user_data_dir == "" {
		return device_identity{}, errors.New("user data directory not provided")
	}

	if err := os.MkdirAll(user_data_dir, 0o700); err != nil {
		return device_identity{}, fmt.Errorf("failed to create user data directory: %w", err)
	}

	path := filepath.Join(user_data_dir, identity_filename)

	if raw, err := os.ReadFile(path); err == nil {
		var id device_identity
		if err := json.Unmarshal(raw, &id); err != nil {
			return device_identity{}, fmt.Errorf("device.json is malformed: %w", err)
		}
		if id.DeviceID == "" {
			return device_identity{}, errors.New("device.json is missing deviceId")
		}
		if id.ShortHash == "" {
			id.ShortHash = short_hash_from_id(id.DeviceID)
		}
		return id, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return device_identity{}, fmt.Errorf("failed to read device.json: %w", err)
	}

	id, err := generate_identity()
	if err != nil {
		return device_identity{}, err
	}

	encoded, err := json.MarshalIndent(id, "", "  ")
	if err != nil {
		return device_identity{}, fmt.Errorf("failed to encode identity: %w", err)
	}

	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return device_identity{}, fmt.Errorf("failed to write device.json: %w", err)
	}

	return id, nil
}

func generate_identity() (device_identity, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return device_identity{}, fmt.Errorf("failed to generate device id: %w", err)
	}
	device_id := hex.EncodeToString(raw)

	return device_identity{
		DeviceID:      device_id,
		ShortHash:     short_hash_from_id(device_id),
		CreatedAt:     time.Now().UTC(),
		SchemaVersion: identity_schema_version,
	}, nil
}

func short_hash_from_id(device_id string) string {
	clean := strings.ToLower(device_id)
	if len(clean) < 4 {
		return clean
	}
	return clean[:4]
}

func default_user_data_dir() string {
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return filepath.Join(dir, "lanshare")
	}
	return "."
}