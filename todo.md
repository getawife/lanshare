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
- Multi-interface subnet broadcast scanning (`getBroadcastAddresses`) enumerating active IPv4 network adapters.
- Distinct `HTTPPort` vs. `Port` device mapping to route transfers over HTTP cleanly.
- End-to-end data integrity verification using SHA-256 checksums (`computeFileSHA256` & real-time receiver `io.MultiWriter` checksum validation).
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
- Automated unit test suite (`go test ./...`) covering path safety, SHA-256 checksum validation, and broadcast address calculation.
- Build succeeds for both:
  - `Client`
  - `backend`

## What is still missing

### Security & Transport

- **Upgrade local Electron-to-Backend API from HTTP to HTTPS (self-signed TLS) to prevent localhost attack vectors.**
- Proper authenticated device pairing / trust handshake (TLS / PIN exchange / QR code) for peer-to-peer communication.
- Tokenized permission scopes for browser/share endpoints.

### Networking & Discovery

- mDNS / DNS-SD discovery (multicast support for cross-subnet / VLAN visibility).
- Browser upload mode with password/token expiration.

### User Experience & OS Integration

- System tray menu and background mode behavior.
- Native desktop notifications.
- Clipboard sync across devices.
- QR code generation for web-share access.

### Transfer Resilience

- Transfer cancellation and retry flows.
- Resume support for interrupted transfers.

### Production Lifecycle & Distribution

- **Backend watchdog timer:** Electron should monitor the Go PID and forcefully kill/restart it if it hangs or crashes unexpectedly.
- Auto-updater integration (`electron-updater`).
- Code signing and notarization (macOS) / Authenticode signing (Windows) for store distribution.

## Recommended next steps

1. **Critical:** Migrate local API to HTTPS with a dynamically generated self-signed TLS certificate.
2. Add trust/pairing and encrypted (TLS) LAN transport between devices.
3. Add tray, native notifications, and clipboard sync.
4. Finish browser share support and secure tokenized permissions.
5. Add cancellation, retry, and resume support.
6. Implement the backend watchdog and build pipeline auto-updater.
