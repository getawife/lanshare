# Lanshare Issues & Technical Debt

This document tracks identified architectural issues, bugs, logic mismatches, and security vulnerabilities across the Go backend and Electron/React client.

---

## 1. Critical Protocol & Networking Bugs

### Issue 1.1: Peer HTTP Port vs. UDP Ephemeral Port Mismatch

- **Status**: Resolved
- **Severity**: Critical
- **Files**: `backend/server_state.go`, `backend/types.go`
- **Resolution**: Added `HTTPPort` field to `Device` struct. `RunDiscoveryListener` extracts `httpPort` from discovery packets, and `SendFiles` targets `peer.HTTPPort` for all `/api/receive` file transfers.

### Issue 1.2: UDP Discovery Broadcast Listener Bound to Ephemeral Port

- **Status**: Resolved
- **Severity**: Critical
- **Files**: `backend/main.go`, `backend/server_state.go`
- **Resolution**: Updated `main.go` to bind `lanLn` to fixed UDP port `43821` (with fallback to dynamic port `:0` if port 43821 is already occupied). Additionally, the `RunLoopbackPeerProbe` goroutine is permanently removed in production builds to prevent "Local Test Peer" clutter on the device list.

### Issue 1.3: Single-Interface Broadcast Limitation

- **Status**: Resolved
- **Severity**: Medium
- **Files**: `backend/server_state.go`
- **Resolution**:
  - Implemented per-interface discovery broadcasting in `RunDiscovery`. The backend now computes local/broadcast address pairs for each active non-loopback IPv4 interface and binds a UDP socket to each interface's unicast IP to send discovery payloads to that interface's broadcast address. This ensures discovery packets are emitted on each NIC (including VPNs) rather than only the system default.
  - Added helper `getInterfaceBroadcastPairs` and best-effort sending with diagnostics warnings when sends fail (firewall/permission/network errors).
  - Retains a fallback to global IPv4 broadcast for environments where per-interface sends cannot be performed.
  - Validation: existing backend tests run successfully; recommend manual integration testing across multiple NICs/VPNs to confirm discovery reachability.

---

## 2. Security & Consent Vulnerabilities

### Issue 2.1: Unsolicited Direct File Writes Without Receiver Consent

- **Status**: Resolved (UI Integration)
- **Severity**: Critical / Security
- **Files**: `backend/main.go`, `client/src/pages/Home.tsx`
- **Resolution**: `Home.tsx` now renders `IncomingTransfer` component whenever an incoming file transfer event is active, displaying sender details and transfer options.

### Issue 2.2: Backend Unaware of User Settings

- **Status**: Resolved
- **Severity**: High
- **Files**: `backend/main.go`, `backend/server_state.go`, `backend/types.go`, `client/electron/main.ts`
- **Resolution**:
  - Added `BackendSettings` support throughout the backend and client.
  - Backend changes:
    - `Device` now contains a `Settings BackendSettings` field so peer records can include advertised preferences.
    - `/api/settings` endpoint accepts POST from the Electron client and stores the server-side settings via `UpdateSettings`.
    - Discovery payloads include the backend's current `s.settings` so other peers can see advertised preferences.
    - `RunDiscoveryListener` parses an optional `settings` object from incoming discovery packets and populates `peer.Settings` when present.
  - Electron client changes:
    - Added `pushSettingsToBackend()` and now POSTs the persisted Electron settings to `/api/settings` on startup and whenever settings are saved. This causes the backend to advertise the current settings in its discovery packets.
  - Security/behavior notes:
    - Settings advertised by peers are treated as advisory; the local node's effective policy (local settings) must still be enforced and should not be overridden by remote advertising.
    - Backward compatibility: discovery packets without a `settings` object are handled gracefully and default values are used.
  - Validation: backend unit tests ran successfully; manual cross-instance testing is recommended to verify discovery and transfer behaviors honor settings as intended.

### Issue 2.3: Unused Frontend `IncomingTransfer` Component

- **Status**: Resolved
- **Severity**: Medium
- **Files**: `client/src/components/IncomingTransfer/IncomingTransfer.tsx`, `client/src/pages/Home.tsx`
- **Resolution**: Imported and wired `IncomingTransfer` into `Home.tsx` to present incoming file prompts.

### Issue 2.4: Local API Lacks Admin Token Authentication

- **Status**: Resolved
- **Severity**: Critical / Security
- **Files**: `backend/main.go`, `client/electron/main.ts`, `client/electron/preload.cts`
- **Resolution**:
  - Electron Main (`main.ts`) generates a cryptographically secure `adminToken` using `crypto.randomBytes(16).toString("hex")` on every app launch.
  - Electron Main injects `LANSHARE_ADMIN_TOKEN` into the Go backend environment variables when spawning the subprocess.
  - Go Backend (`main.go`) reads `LANSHARE_ADMIN_TOKEN` into `b.state.AdminToken` and strictly verifies the `X-Lanshare-Token` header against it on all privileged endpoints (`/api/respond-transfer`, `/api/settings` POST).
  - Electron Preload (`preload.cts`) and IPC handlers (`backend:fetch`, `transfer:respond`) automatically inject the `X-Lanshare-Token` header into all local API requests, keeping the React renderer completely unaware of the secret.
  - This prevents arbitrary local processes or malicious websites from triggering file transfers or changing app settings without authorization.

---

## 3. Multi-OS, File System & Path Handling Edge Cases

### Issue 3.1: Windows Drive Letters and Absolute Relative Paths

- **Status**: Resolved
- **Severity**: High
- **Files**: `backend/main.go` (`safeDownloadPath`), `backend/main_test.go`
- **Resolution**: `safeDownloadPath` now strips volume names (e.g., `C:`) and leading slashes before resolving paths inside `Downloads`. Verified with unit tests.

### Issue 3.2: File Overwrite Collisions & Windows `os.Rename` Failures

- **Status**: Resolved
- **Severity**: High
- **Files**: `backend/main.go` (`getUniqueFilePath`), `backend/main_test.go`
- **Resolution**: Implemented `getUniqueFilePath` which checks for existing destination files and automatically appends `(1)`, `(2)`, etc. (e.g., `photo (1).png`). Verified with unit tests.

### Issue 3.3: OS Name and Device Type Enum Inconsistency

- **Status**: Resolved
- **Severity**: Low
- **Files**: `backend/server_state.go`
- **Resolution**: Implemented `formatOSName` helper in Go backend to translate `darwin`, `windows`, `linux` to `macOS`, `Windows`, `Linux`.

### Issue 3.4: Hardcoded Windows Reference in Settings UI

- **Status**: Resolved
- **Severity**: Low
- **Files**: `client/src/pages/Settings.tsx`
- **Resolution**: Changed label to OS-neutral `"Start at system login"`.

---

## 4. Event Streaming & UI State Mismatches

### Issue 4.1: Peer Disconnection / Offline Events Not Published via SSE

- **Status**: Resolved
- **Severity**: Medium
- **Files**: `backend/server_state.go`
- **Resolution**: Updated `RunExpiredPeerSweep` to publish an SSE `peer` event with `Status: "offline"` whenever a peer's `LastSeen` exceeds the expiration threshold.

### Issue 4.2: Missing Sender Details in Incoming Transfer Events

- **Status**: Resolved
- **Severity**: Medium
- **Files**: `backend/main.go`, `backend/server_state.go`
- **Resolution**: Sender `peerId` and `deviceName` are now included in multipart metadata payloads and passed into all published incoming transfer SSE events.

### Issue 4.3: Unwired UI Actions ("Open in folder", "Retry")

- **Status**: Resolved
- **Severity**: Low
- **Files**: `client/src/pages/Transfers.tsx`, `client/electron/main.ts`, `client/electron/preload.cts`
- **Resolution**: Added `folder:open` IPC handler using Electron's `shell.openPath` / `shell.showItemInFolder`, and wired the "Open in folder" button in `Transfers.tsx`.

---

## 5. Port Binding Conflicts & Versioning

### Issue 5.1: Backend Process Exit on Port Collision

- **Status**: Resolved
- **Severity**: Medium
- **Files**: `backend/main.go`
- **Description**:
  - `httpPort` defaults to `43821`. If in use, `net.Listen` returns an error and backend calls `log.Fatal(err)`.

### Issue 5.2: Inconsistent App Version Strings

- **Status**: Resolved
- **Severity**: Low
- **Files**: `client/src/pages/Settings.tsx`
- **Resolution**: Updated frontend version display to `v1.0.0` matching the Go backend version.
