package main

import "time"

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
	Files      []FileItem `json:"files"`
}

type ShareRequest struct {
	Files    []string `json:"files"`
	Password string   `json:"password,omitempty"`
	ExpiresIn int     `json:"expiresIn,omitempty"`
}

type AppState struct {
	Device   Device   `json:"device"`
	Port     int      `json:"port"`
	HTTPPort int      `json:"httpPort"`
	Peers    []Device `json:"peers"`
}
