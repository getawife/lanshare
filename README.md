# Lanshare

Lanshare is a free, open-source desktop app for sending files and folders between computers on the same Wi-Fi or Ethernet network. Transfers go directly from device to device. No account, server or internet connection is involved.

## Requirements

Two or more computers on the same local network, running the same Lanshare version.

Supported platforms:

- Windows 10 or later (x64 and ARM64)
- macOS on Apple Silicon (ARM64)
- Linux (x64 and ARM64) via AppImage or Debian package

## Install

Download the installer for your platform from the [latest release](https://github.com/getawife/lanshare/releases/latest):

- **Windows:** `Lanshare Setup <version>.exe`. If SmartScreen warns, choose "More info" then "Run anyway". The installer is not code-signed yet.
- **macOS:** `Lanshare-<version>-arm64.dmg`. Open the disk image, drag Lanshare into Applications, then right-click and choose Open on first launch. The app is not notarized yet.
- **Linux:** `Lanshare-<version>.AppImage` (run `chmod +x` on it first) or `lanshare_<version>_amd64.deb` / `lanshare_<version>_arm64.deb`.

## How to use

1. Open Lanshare on each computer.
2. Wait a moment for the other computers to appear under Devices.
3. Select the receiving device.
4. Add files or a folder: drag them in, use Select Files / Select Folder, or paste a file.
5. Confirm the transfer. The receiver sees a prompt and accepts or declines it.

## Network and firewall

| Purpose                | Protocol and port               | Reachable from     |
| ---------------------- | ------------------------------- | ------------------ |
| Device discovery       | UDP 43821                       | Local network      |
| File transfer          | TCP 43841 (up to 43850 if busy) | Local network      |
| App to its own backend | TCP 43821 (up to 43830 if busy) | This computer only |

Allow Lanshare on Private networks in your firewall. Your network profile on Windows should be Private, not Public. The local backend port needs no firewall rule because it only listens on `127.0.0.1`.

## Troubleshooting

If no devices appear:

- Confirm both computers are on the same network and the same subnet.
- Check that your router doesn't isolate clients. Guest Wi-Fi and some public networks do.
- Check the firewall rules above.
- Turn off VPNs or virtual adapters that might catch broadcast traffic.
- Make sure both computers run the same Lanshare version. Older versions that used plain HTTP can't exchange files with versions 1.0.5 and above.

Lanshare shows a banner when the backend fails to start, with the cause (port in use, blocked by security software, missing binary, or health-check timeout) and a Restart Service button.

## Build from source

Prerequisites:

- Go 1.22 or later
- Node.js 22 or later
- pnpm 10 or later

```bash
git clone https://github.com/getawife/lanshare.git
cd lanshare/client
pnpm install
pnpm dev
```

Produce an installer for your current platform:

```bash
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

Environment variables for development:

- `LANSHARE_HTTP_PORT`: local backend port (default 43821).
- `LANSHARE_LAN_HTTP_PORT`: transfer port (default 43841).
- `LANSHARE_ADMIN_TOKEN`: set by the desktop app when it starts the backend. Without it the local API rejects every request.
- `LANSHARE_LOOPBACK_PEER_HTTP_PORT`: the transfer port of a second local instance, so you can test transfers on one machine.

## Contributing

Bug fixes, documentation and feature suggestions are welcome. Before opening a pull request, run:

```bash
cd backend
gofmt -l .
go vet ./...
go test ./...
```

```bash
cd client
pnpm exec tsc --noEmit
pnpm lint
```

`gofmt -l` must print nothing, and the other commands must pass with no errors. Existing warnings on `main` are fine.

### Pull requests:

- Fork the repository and branch from `main`.
- Keep commits focused.
- Describe the change, why it's needed and how you tested it.
- Push follow-up commits to the same branch in response to review. Don't force-push over review comments.

### Issues

- Search existing issues first
- Check you're on the latest release, and include your OS and version, the Lanshare version (Settings, About), what you expected, what happened, reproduction steps and any error shown in the app.

Security reports should not go in public issues. See [SECURITY.md](./SECURITY.md). Accessibility problems are welcome as regular issues. See [ACCESSIBILITY.md](./ACCESSIBILITY.md).

## License

See [LICENSE](./LICENSE).
