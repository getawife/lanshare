package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type trusted_registry struct {
	TrustedIDs    []string `json:"trustedIds"`
	SchemaVersion int      `json:"schemaVersion"`
}

const trusted_schema_version = 1
const trusted_filename = "trusted.json"

func load_trusted_ids(user_data_dir string) (map[string]struct{}, error) {
	if user_data_dir == "" {
		return map[string]struct{}{}, nil
	}

	path := filepath.Join(user_data_dir, trusted_filename)

	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]struct{}{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read trusted.json: %w", err)
	}

	var reg trusted_registry
	if err := json.Unmarshal(raw, &reg); err != nil {
		return nil, fmt.Errorf("trusted.json is malformed: %w", err)
	}

	out := make(map[string]struct{}, len(reg.TrustedIDs))
	for _, id := range reg.TrustedIDs {
		if id != "" {
			out[id] = struct{}{}
		}
	}
	return out, nil
}

func save_trusted_ids(user_data_dir string, ids map[string]struct{}) error {
	if user_data_dir == "" {
		return nil
	}

	if err := os.MkdirAll(user_data_dir, 0o700); err != nil {
		return fmt.Errorf("failed to create user data directory: %w", err)
	}

	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)

	reg := trusted_registry{
		TrustedIDs:    sorted,
		SchemaVersion: trusted_schema_version,
	}

	encoded, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode trusted registry: %w", err)
	}

	path := filepath.Join(user_data_dir, trusted_filename)
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return fmt.Errorf("failed to write trusted.json: %w", err)
	}
	return nil
}