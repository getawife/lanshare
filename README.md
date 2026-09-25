# Lanshare

Lanshare is a free, open-source desktop app for sending files and folders between computers on the same Wi-Fi or Ethernet network.

## Requirements

- Two or more computers connected to the same Wi-Fi or Ethernet network.
- Supported platforms:
  1. Windows 10 or later (x64 and ARM64)
  2. macOS on Apple Silicon (ARM64)
  3. Linux (x64 and ARM64) via AppImage or Debian package

## Install

Download the installer for your platform from the [latest release](https://github.com/getawife/lanshare/releases/latest):

- **Windows** — `Lanshare Setup <version>.exe`. Runs on Windows 10 and later. if SmartScreen warns, choose "More info" then "Run anyway."
- **macOS** — `Lanshare-<version>-arm64.dmg`. Open the disk image, drag Lanshare into Applications, and launch it. Gatekeeper will require a right-click → Open on first launch because the app is not yet notarized.
- **Linux** — `Lanshare-<version>.AppImage` for a portable build, or `lanshare_<version>_amd64.deb` / `lanshare_<version>_arm64.deb` for Debian and Ubuntu. Mark the AppImage executable (`chmod +x Lanshare-*.AppImage`) before running.

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
