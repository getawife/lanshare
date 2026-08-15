# Lanshare Testing List

## Goal

Verify discovery, sending, receiving, folder reconstruction, and failure handling on two devices on the same network.

## Important note

`npm run build` in `client/` is not enough by itself to test transfers between two computers. That command builds the renderer bundle and Electron TypeScript output, but Lanshare still needs the Electron app to launch the local Go backend process on each machine.

To test transfers on two computers:

1. Build the client.
2. Run the Electron app on both machines so each one starts its own backend.
3. Use the Devices view to discover the other peer.

## Setup

1. On both computers, install Node.js and Go if they are not already available.
2. In `client/`, run `npm install`.
3. In `backend/`, make sure Go can build the backend.
4. Make sure both computers are on the same LAN or Wi-Fi network.
5. Allow Lanshare through any firewall prompt so UDP discovery and local HTTP traffic can work.

## Basic Startup Test

1. On computer A, run the app in dev mode with `npm run dev`.
2. Confirm the window opens and the title bar renders correctly.
3. Confirm the backend starts without errors.
4. Repeat on computer B.

## Discovery Test

1. Wait for both machines to appear in the Devices view.
2. Confirm each machine shows the other device name and status.
3. Refresh discovery manually and confirm the peer list stays stable.
4. Leave one app open for a minute and confirm the peer eventually goes offline if the other app closes.

## File Send Test

1. Select a peer on computer A.
2. Send a small file from A to B.
3. Confirm a live progress card appears.
4. Confirm the transfer completes and the file lands in the recipient download folder.
5. Confirm the Transfers tab records the completed transfer.

## Folder Send Test

1. Select a folder containing nested subfolders and several files.
2. Send it from computer A to B.
3. Confirm the progress UI treats it as a folder transfer.
4. Confirm the folder tree is recreated on the receiver.
5. Confirm empty folders are preserved if present.

## Edge-Case Tests

1. Try sending a file with the same name as an existing file in the download folder and confirm the behavior is safe and predictable.
2. Try sending a folder with spaces and Unicode characters in the name.
3. Try sending a zero-byte file.
4. Try sending a missing or deleted file and confirm the transfer fails cleanly.
5. Try closing the source app mid-transfer and confirm the transfer fails instead of hanging.
6. Try opening Lanshare with only one computer online and confirm the UI handles an empty peer list.

## Failure Handling

1. Disconnect the network during a transfer and confirm the UI shows failure.
2. Block the backend port with a firewall rule and confirm discovery or transfer fails clearly.
3. Stop one app while the other is still open and confirm the peer status expires.

## What to record

1. Whether discovery worked.
2. Whether file and folder transfers completed.
3. Whether folder structure was preserved.
4. Whether failures were reported clearly.
5. Whether the download path was safe and stayed inside the expected folder.

