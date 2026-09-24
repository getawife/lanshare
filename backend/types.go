package main

import "time"

type backend_settings struct {
	device_name          string `json:"deviceName,omitempty"`
	ask_before_accepting bool   `json:"askBeforeAccepting"`
	auto_accept_trusted  bool   `json:"autoAcceptTrusted"`
	download_folder      string `json:"downloadFolder"`
}

type device struct {
	id              string           `json:"id"`
	name            string           `json:"name"`
	os              string           `json:"os"`
	type_           string           `json:"type"`
	ip              string           `json:"ip"`
	port            int              `json:"port"`
	http_port       int              `json:"httpPort"`
	status          string           `json:"status"`
	trusted         bool             `json:"trusted"`
	protocol        int              `json:"protocol"`
	version         string           `json:"version"`
	capabilities    []string         `json:"capabilities"`
	last_seen       time.Time        `json:"lastSeen"`
	device_hash     string           `json:"deviceHash"`
	advertise_name  string           `json:"advertiseName"`
	discoverable_at time.Time        `json:"discoverableAt"`
	settings        backend_settings `json:"settings,omitempty"`
}

type file_item struct {
	path          string `json:"path"`
	name          string `json:"name"`
	size          int64  `json:"size"`
	is_dir        bool   `json:"isDir"`
	checksum      string `json:"checksum,omitempty"`
	relative_to   string `json:"relativeTo,omitempty"`
	relative_path string `json:"relativePath,omitempty"`
}

type transfer_request struct {
	transfer_id string      `json:"transferId,omitempty"`
	peer_id     string      `json:"peerId"`
	device_name string      `json:"deviceName,omitempty"`
	files       []file_item `json:"files"`
}

type share_request struct {
	files      []string `json:"files"`
	password   string   `json:"password,omitempty"`
	expires_in int      `json:"expiresIn,omitempty"`
}

type network_diagnostics struct {
	has_active_lan      bool     `json:"hasActiveLan"`
	interfaces          []string `json:"interfaces"`
	udp_discovery_bound bool     `json:"udpDiscoveryBound"`
	udp_port            int      `json:"udpPort"`
	warnings            []string `json:"warnings"`
}

type app_state struct {
	device      device              `json:"device"`
	port        int                 `json:"port"`
	http_port   int                 `json:"httpPort"`
	peers       []device            `json:"peers"`
	diagnostics network_diagnostics `json:"diagnostics"`
}