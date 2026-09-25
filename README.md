# Lanshare

Lanshare is a free, open-source desktop app for sending files and folders between computers on the same Wi-Fi or Ethernet network.

## Features

- Send files and folders between computers.
- Works entirely over the local network, no internet connection required.
- Native desktop app for Windows, macOS, and Linux.
- SHA-256 verification on every transferred file.

## Requirements

Two or more computers connected to the same Wi-Fi or Ethernet network.

Supported platforms:

- Windows 10 or later (x64 and ARM64)
- macOS on Apple Silicon (ARM64)
- Linux (x64 and ARM64) via AppImage or Debian package

## Install

Download the installer for your platform from the [latest release](https://github.com/getawife/lanshare/releases/latest):

- **Windows:** `Lanshare Setup <version>.exe`. Runs on Windows 10 and later. If SmartScreen warns, choose "More info" then "Run anyway."
- **macOS:** `Lanshare-<version>-arm64.dmg`. Open the disk image, drag Lanshare into Applications, and launch it. Gatekeeper will require a right-click → Open on first launch because the app is not yet notarized.
- **Linux:** `Lanshare-<version>.AppImage` for a portable build, or `lanshare_<version>_amd64.deb` / `lanshare_<version>_arm64.deb` for Debian and Ubuntu. Mark the AppImage executable (`chmod +x Lanshare-*.AppImage`) before running.

## Screenshots

Screenshots are available in [assets/screenshots](./assets/screenshots)

## Build from source

Prerequisites:

- Go 1.22 or later.
- Node.js 22 or later.
- pnpm 10 or later.

Clone the repository and install the client dependencies:

```bash
git clone https://github.com/getawife/lanshare.git
cd lanshare/client
pnpm install
```

Run the app in development mode.

```bash
pnpm dev
```

Produce an installer for your current platform:

```bash
pnpm dist:win
pnpm dist:mac
pnpm dist:linux

```

## How to use

- Open Lanshare on each computer.

- Wait a moment for the other machines to appear in the device list.

- Select the files or folders to send, then choose the receiving computer.

- Accept the transfer on the other computer.

## Contributing & Issues

Bug fixes, performance improvements, documentation updates, and feature suggestions are all welcome.

Before submitting a change make sure to run:

```bash
cd backend
go vet ./...
go test ./...
```

and

```bash
cd client
pnpm exec tsc --noEmit
pnpm lint
```

Both must pass with no errors. Warnings are fine if they already exist on `main`.

### Issues

Found a bug or something behaving unexpectedly? Open an issue on the [Issue tracker](https://github.com/getawife/lanshare/issues).

Before opening a new issue, please:

- Search existing issues to avoid duplicates.
- Check that you are running the latest release.

Include the following in your report:

- Your operating system and version.
- The Lanshare version (visible in Settings under "About").
- A clear description of what you expected and what actually happened.
- Reproduction steps if you can determine them.
- Any error message shown in the app.

For security-sensitive reports, please do not open a public issue.
Contact me at contactgetawife@protonmail.com with the details.

### Pull Requests

- Fork the repository and create a branch from main.

- Keep commits focused.

- Open a pull request against main. Include a short description of the change, why it is needed, and how you tested it.

- It will be reviewed and may require additional changes. Push additional commits to the same branch in response.

- Do not force-push over review comments.

## License

Please click [here](./LICENSE) for more information.
