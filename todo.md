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
- LAN peer discovery over UDP broadcast bound to port `43821` (with dynamic fallback).
- Distinct `HTTPPort` vs. `Port` device mapping to route transfers over HTTP cleanly.
- Peer list shown in the renderer from backend state with real-time SSE peer lifecycle events (including offline sweeps).
- File transfer request plumbing from UI to backend with sender device metadata attached.
- Streaming file transfer with live progress events.
- Incoming transfer prompt overlay integration (`IncomingTransfer.tsx`).
- Safe download path sanitization (stripping Windows drive specifiers and relative root paths).
- Automatic file collision resolution (`photo (1).png`) preventing accidental file overwrites and OS rename crashes.
- Open download folder IPC bridge (`shell.openPath` / `shell.showItemInFolder`) wired to transfer history.
- Folder structure preservation and safe download reconstruction.
- Temporary local web-share endpoint.
- Basic settings persistence in Electron with platform-agnostic UI labels.
- Automated unit test suite (`go test ./...`) covering path safety and collision handling.
- Build succeeds for both:
  - `Client`
  - `backend`

## What is still missing

- Multi-interface UDP broadcast enumeration across secondary network adapters.
- Proper authenticated device pairing / trust handshake (TLS / PIN exchange).
- mDNS / DNS-SD discovery.
- Transfer cancellation and retry flows.
- Integrity verification with checksums (SHA-256).
- Resume support for interrupted transfers.
- Clipboard sync across devices.
- System tray menu and background mode behavior.
- Native desktop notifications.
- QR code generation for browser sharing.
- Browser upload mode & tokenized permissions.

## Recommended next steps

1. Add multi-interface UDP broadcast scanning and mDNS discovery.
2. Add trust/pairing and encrypted (TLS) LAN transport.
3. Finish browser share support and secure tokenized permissions.
4. Add tray, native notifications, and clipboard sync.
5. Add cancellation, retry, resume, and checksum verification.
