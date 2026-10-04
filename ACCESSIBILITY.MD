# Accessibility

Lanshare is a free, open-source desktop app for sending files and folders between computers on the same Wi-Fi or Ethernet network. Transfers go directly from device to device. No account, server or internet connection is involved. It aims to be usable with a keyboard, a screen reader, and common OS accessibility settings.

## How to test

When changing the interface, check at least:

1. Use the whole flow with the keyboard only: pick a device, add files, send, cancel, accept and decline.
2. Run with a screen reader: NVDA or Narrator on Windows, VoiceOver on macOS, Orca on Linux. Confirm every control has a name and every state change is announced.
3. Zoom to 200% and confirm nothing is cut off.
4. Turn on the OS "reduce motion" and high-contrast settings.
5. Check text contrast with a tool such as the WebAIM contrast checker.
6. Run an automated checker such as axe DevTools. It will not find everything, so do not rely on it alone.

## Contributing accessible changes

- Use native elements (`button`, `label`, `input`) before ARIA.
- Give every control a visible or accessible name.
- Do not use colour alone to show state.
- Do not nest interactive elements.
- Announce changes that happen without user action (progress, errors, incoming requests).
- Keep a keyboard alternative for any drag-and-drop action.

## Reporting an accessibility problem

Open an [issue](https://github.com/getawife/lanshare/issues) with the label `other` if you can, and include:

- The operating system and Lanshare version (Settings -> About).
- The assistive technology and its version, if you use one.
- What you tried to do, what happened, and what you expected.

If you cannot use GitHub, email [contactgetawife@protonmail.com](mailto:contactgetawife@protonmail.com).
