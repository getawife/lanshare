# LANShare Status

## What exists now

- Electron desktop shell with secure defaults:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - preload-based IPC bridge
- Electron starts a local Go backend process.
- Electron can stop the backend when the app exits.
- Local backend control API on `127.0.0.1:43821`.
- Basic device state endpoint for the renderer.
- LAN peer discovery over UDP broadcast.
- Peer list shown in the renderer from backend state.
- File transfer request plumbing from UI to backend.
- Temporary local web-share endpoint.
- Basic settings persistence in Electron.
- Build succeeds for both:
  - `Client`
  - `backend`

## What is still missing

- Real encrypted peer-to-peer file streaming.
- Proper authenticated device pairing/trust.
- mDNS / DNS-SD discovery.
- Discovery expiry and richer peer lifecycle handling.
- Real folder transfer preservation.
- Transfer progress updates from backend to UI.
- Cancellation and retry flows.
- Integrity verification with checksums.
- Resume support for interrupted transfers.
- Clipboard sync.
- Tray menu and background mode behavior.
- Native notifications.
- QR code generation for browser sharing.
- Browser upload mode.
- Secure tokenized browser-share permissions.
- Path-safe directory transfer and download reconstruction.
- Transfer history backed by real backend events.
- WebSocket or SSE event consumption in the renderer.
- Tests for discovery, transfer, and security cases.

## Recommended next steps

1. Build a real transfer protocol with streaming and progress events.
2. Add trust/pairing and encrypted LAN transport.
3. Finish folder transfer and browser share support.
4. Add tray, notifications, and clipboard sync.
