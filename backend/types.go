package main

import "time"

type backend_settings struct {
	DeviceName         string `json:"deviceName,omitempty"`
	AskBeforeAccepting bool   `json:"askBeforeAccepting"`
	AutoAcceptTrusted  bool   `json:"autoAcceptTrusted"`
	DownloadFolder     string `json:"downloadFolder"`
}

type device struct {
	ID             string           `json:"id"`
	Name           string           `json:"name"`
	OS             string           `json:"os"`
	Type           string           `json:"type"`
	IP             string           `json:"ip"`
	Port           int              `json:"port"`
	HTTPPort       int              `json:"httpPort"`
	Status         string           `json:"status"`
	Trusted        bool             `json:"trusted"`
	Protocol       int              `json:"protocol"`
	Version        string           `json:"version"`
	Capabilities   []string         `json:"capabilities"`
	LastSeen       time.Time        `json:"lastSeen"`
	DeviceHash     string           `json:"deviceHash"`
	AdvertiseName  string           `json:"advertiseName"`
	DiscoverableAt time.Time        `json:"discoverableAt"`
	Settings       backend_settings `json:"settings,omitempty"`
}

type file_item struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	IsDir        bool   `json:"isDir"`
	Checksum     string `json:"checksum,omitempty"`
	RelativeTo   string `json:"relativeTo,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
}

type transfer_request struct {
	TransferID string      `json:"transferId,omitempty"`
	PeerID     string      `json:"peerId"`
	DeviceName string      `json:"deviceName,omitempty"`
	Files      []file_item `json:"files"`
}

type share_request struct {
	Files     []string `json:"files"`
	Password  string   `json:"password,omitempty"`
	ExpiresIn int      `json:"expiresIn,omitempty"`
}

type network_diagnostics struct {
	HasActiveLAN      bool     `json:"hasActiveLan"`
	Interfaces        []string `json:"interfaces"`
	UDPDiscoveryBound bool     `json:"udpDiscoveryBound"`
	UDPPort           int      `json:"udpPort"`
	Warnings          []string `json:"warnings"`
}

type app_state struct {
	Device      device              `json:"device"`
	Port        int                 `json:"port"`
	HTTPPort    int                 `json:"httpPort"`
	Peers       []device            `json:"peers"`
	Diagnostics network_diagnostics `json:"diagnostics"`
}