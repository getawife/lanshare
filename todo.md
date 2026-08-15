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
- Streaming file transfer with live progress events.
- Folder structure preservation and safe download reconstruction.
- Temporary local web-share endpoint.
- Basic settings persistence in Electron.
- Build succeeds for both:
  - `Client`
  - `backend`

## What is still missing

- Proper authenticated device pairing/trust.
- mDNS / DNS-SD discovery.
- Discovery expiry and richer peer lifecycle handling.
- Cancellation and retry flows.
- Integrity verification with checksums.
- Resume support for interrupted transfers.
- Clipboard sync.
- Tray menu and background mode behavior.
- Native notifications.
- QR code generation for browser sharing.
- Browser upload mode.
- Secure tokenized browser-share permissions.
- Tests for discovery, transfer, and security cases.

## Recommended next steps

1. Add trust/pairing and encrypted LAN transport.
2. Finish browser share support and secure tokenized permissions.
3. Add tray, notifications, and clipboard sync.
4. Add cancellation, retry, resume, and checksum verification.
