# Security Policy

Lanshare moves files between devices on a local network. This document describes what it protects, who it protects against, what it does not protect, and how to report a problem.

## Reporting a vulnerability

Please do not open a public issue for security-sensitive reports. Use [private vulnerability reporting](https://github.com/getawife/lanshare/security/advisories/new) and include:

- A description of the issue.
- Steps to reproduce, or a proof of concept.
- The Lanshare version (Settings -> About).
- Your operating system and version.
- Your network setup (same LAN, wired, Wi-Fi, VPN, and so on).

If you cannot use GitHub, email [contactgetawife@protonmail.com](mailto:contactgetawife@protonmail.com).

## Supported versions

Only the latest release receives security fixes. Update first, then re-test. Automatic updates are delivered through GitHub Releases. On macOS, update behaviour depends on the app being code-signed, which is not yet the case.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

## Credits

If a report is valid, a fix is developed privately and released before public disclosure. Reporters are credited in the README's credit section unless they prefer to stay anonymous. Good-faith research on your own devices and network is welcome. Lower-severity issues that expose no user data and allow no remote code execution may be filed as regular issues.
