# Lanshare Testing List

## Goal

Verify discovery across subnets, sending, receiving, SHA-256 checksum integrity, folder reconstruction, collision handling, and failure handling on two devices on the same network.

## Important note

`npm run build` in `client/` is not enough by itself to test transfers between two computers. That command builds the renderer bundle and Electron TypeScript output, but Lanshare still needs the Electron app to launch the local Go backend process on each machine.

To test transfers on two computers:

1. Build the client (`npm run build`).
2. Run the Electron app on both machines so each one starts its own backend.
3. Use the Devices view to discover the other peer.

## Temporary Same-Device Test Mode

You can run two Lanshare clients on one computer for local testing by giving each one a different backend port.

1. Start the first client with `LANSHARE_HTTP_PORT=43821`.
2. Start the second client with `LANSHARE_HTTP_PORT=43822`.
3. Set `LANSHARE_LOOPBACK_PEER_HTTP_PORT` for each client to point at the other instance.
4. Launch both clients and confirm each one shows a `Local Test Peer` entry.
5. Use that peer entry to send files between the two instances.

Example layout:

1. Client A: `LANSHARE_HTTP_PORT=43821` and `LANSHARE_LOOPBACK_PEER_HTTP_PORT=43822`
2. Client B: `LANSHARE_HTTP_PORT=43822` and `LANSHARE_LOOPBACK_PEER_HTTP_PORT=43821`

## Setup

1. On both computers, install Node.js and Go if they are not already available.
2. In `client/`, run `npm install`.
3. In `backend/`, run `go test ./...` to verify path safety, SHA-256 integrity, and broadcast subnet calculations.
4. Make sure both computers are on the same LAN or Wi-Fi network.
5. Allow Lanshare through any firewall prompt so UDP discovery (port 43821) and local HTTP traffic can work.
6. For same-device testing, choose two different backend ports and set the temporary environment variables shown above.

## Basic Startup Test

1. On computer A, run the app in dev mode with `npm run dev`.
2. Confirm the window opens and the title bar renders correctly.
3. Confirm the backend starts without errors.
4. Repeat on computer B.

## Discovery Test

1. Wait for both machines to appear in the Devices view.
2. Confirm each machine shows the other device name, OS (`Windows`, `macOS`, `Linux`), and status.
3. Refresh discovery manually and confirm the peer list stays stable across active network interfaces.
4. Close one app and confirm the peer status transitions to offline in the UI via SSE events.

## File Send & Integrity Test

1. Select a peer on computer A.
2. Send a small file from A to B.
3. Confirm a live progress card appears on sender and incoming prompt card appears on receiver.
4. Confirm the transfer completes, SHA-256 hash matches, and the file lands in the recipient download folder.
5. Confirm the Transfers tab records the completed transfer with correct sender device name.
6. Click the "Open in folder" button on the completed transfer card and verify the folder opens in system file manager.

## Folder Send Test

1. Select a folder containing nested subfolders and several files.
2. Send it from computer A to B.
3. Confirm the progress UI treats it as a folder transfer.
4. Confirm the folder tree is recreated on the receiver with matching checksums for all files.
5. Confirm empty folders are preserved if present.

## Edge-Case Tests

1. **SHA-256 Checksum Mismatch**: Verify that if a file is tampered with or corrupted in transit, the receiver deletes the partial `.part` file, returns HTTP 400 (`B-R016`), and displays a "checksum mismatch" failure in the UI.
2. **Duplicate File Transfer**: Try sending a file with the same name as an existing file in the download folder. Confirm it automatically creates `file (1).ext` without failing or overwriting.
3. **Drive Letter / Absolute Path Payload**: Verify incoming files containing paths like `C:\file.txt` or `/file.txt` are safely sanitized into `Downloads/file.txt`.
4. **Special Characters & Unicode**: Try sending a folder with spaces and Unicode characters in the name.
5. **Zero-Byte File Checksum**: Try sending a zero-byte file and confirm the SHA-256 hash `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` is verified cleanly.
6. **Missing / Deleted File**: Try sending a missing or deleted file and confirm the transfer fails cleanly.
7. **Premature App Exit**: Try closing the source app mid-transfer and confirm the recipient transfer transitions to failed.

## Failure Handling

1. Disconnect the network during a transfer and confirm the UI shows failure.
2. Block the backend port with a firewall rule and confirm discovery or transfer fails clearly.
3. Stop one app while the other is still open and confirm the peer status expires via SSE event.

## Automated Verification

- In `backend/`, run `go test -v ./...` to verify path sanitization, unique file naming, SHA-256 checksums, and broadcast subnet calculations.
- In `client/`, run `npm run build` to verify Electron and React compilation.
