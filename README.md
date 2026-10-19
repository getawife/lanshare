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

## Troubleshooting

If no devices appear:

- Confirm both computers are on the same network and the same subnet.
- Check that your router doesn't isolate clients. Guest Wi-Fi and some public networks do.
- Check the firewall rules above.
- Turn off VPNs or virtual adapters that might catch broadcast traffic.
- Make sure both computers run the same Lanshare version. Older versions may not be able to communicate with newer versions due to breaking changes.

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

For more information, see [CONTRIBUTING.md](./CONTRIBUTING.md)

### Issues

- Search existing issues first
- Check you're on the latest release, and include your OS and version, the Lanshare version (Settings, About), what you expected, what happened, reproduction steps and any error shown in the app.

Security reports should not go in public issues. See [SECURITY.MD](./SECURITY.md). Accessibility problems are welcome as regular issues. See [ACCESSIBILITY.MD](./ACCESSIBILITY.MD).

## Contributions & Credits

[![Contributors](https://contrib.rocks/image?repo=getawife/lanshare)](https://github.com/getawife/lanshare/graphs/contributors)

## License

See [LICENSE](./LICENSE).
