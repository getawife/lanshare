package main

import "time"

// BackendSettings mirrors the user-facing settings that affect backend behaviour.
type BackendSettings struct {
	DeviceName         string `json:"deviceName,omitempty"`
	AskBeforeAccepting bool   `json:"askBeforeAccepting"`
	AutoAcceptTrusted  bool   `json:"autoAcceptTrusted"`
	DownloadFolder     string `json:"downloadFolder"`
}

type Device struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	OS            string    `json:"os"`
	Type          string    `json:"type"`
	IP            string    `json:"ip"`
	Port          int       `json:"port"`
	HTTPPort      int       `json:"httpPort"`
	Status        string    `json:"status"`
	Trusted       bool      `json:"trusted"`
	Protocol      int       `json:"protocol"`
	Version       string    `json:"version"`
	Capabilities  []string  `json:"capabilities"`
	LastSeen      time.Time `json:"lastSeen"`
	DeviceHash    string    `json:"deviceHash"`
	AdvertiseName  string    `json:"advertiseName"`
	DiscoverableAt time.Time `json:"discoverableAt"`
	// Settings represents the peer's user-configurable preferences as advertised
	// over discovery (e.g., askBeforeAccepting, autoAcceptTrusted). These are
	// advisory and the local node should still enforce its own effective policy.
	Settings      BackendSettings `json:"settings,omitempty"`
}

type FileItem struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	IsDir      bool   `json:"isDir"`
	Checksum   string `json:"checksum,omitempty"`
	RelativeTo string `json:"relativeTo,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
}

type TransferRequest struct {
	TransferID string     `json:"transferId,omitempty"`
	PeerID     string     `json:"peerId"`
	DeviceName string     `json:"deviceName,omitempty"`
	Files      []FileItem `json:"files"`
}

type ShareRequest struct {
	Files    []string `json:"files"`
	Password string   `json:"password,omitempty"`
	ExpiresIn int     `json:"expiresIn,omitempty"`
}

type NetworkDiagnostics struct {
	HasActiveLAN       bool     `json:"hasActiveLan"`
	Interfaces         []string `json:"interfaces"`
	UDPDiscoveryBound  bool     `json:"udpDiscoveryBound"`
	UDPPort            int      `json:"udpPort"`
	Warnings           []string `json:"warnings"`
}

type AppState struct {
	Device      Device             `json:"device"`
	Port        int                `json:"port"`
	HTTPPort    int                `json:"httpPort"`
	Peers       []Device           `json:"peers"`
	Diagnostics NetworkDiagnostics `json:"diagnostics"`
}

