# Contributing to Lanshare

Lanshare is a free, open-source desktop app for sending files and folders between computers on the same Wi-Fi or Ethernet network. Transfers go directly from device to device. No account, server or internet connection is involved. Thanks for considering a contribution. This document covers what you need to know to set up the project, make a change, and submit it. All contributers will be credited unless they choose otherwise.

## Ways to contribute

Not all contributions are code. All of these are useful:

- Reporting bugs with clear reproduction steps.
- Improving documentation, including this file.
- Suggesting features with a concrete problem they solve.
- Fixing bugs.
- Adding tests.
- Reviewing open pull requests.
- Testing on platforms and network setups that the maintainer doesn't have access to.

## Before you start

For anything larger than a small fix, open an issue first to discuss the approach. This avoids a situation where you write a large PR and it goes to waste. Please, open an issue first.

## Prerequisites:

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

## Tests to run

Before opening a pull request, run:

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

## Pull requests:

- Fork the repository and branch from `main`.
- Keep commits focused.
- Describe the change, why it's needed and how you tested it.
- Push follow-up commits to the same branch in response to review. Don't force-push over review comments.

Security reports should not go in public issues. See [SECURITY.MD](./SECURITY.MD). Accessibility problems are welcome as regular issues. See [ACCESSIBILITY.MD](./ACCESSIBILITY.MD).

## Review Expectations

If your PR sits without a response for more than two weeks, comment on it with a ping. It may have been missed.

## Changes that are not allowed

- Changes that make identifier casing inconsistent with the conventions above.
- Changes to the release workflow that don't solve a problem.
- Changes that disable or bypass security checks, including the admin token, the path traversal sanitization and others.
- Formatting-only PRs that touch every file. If you want to reformat, do it in a PR that only reformats, and explain why.

## Questions

If something in this document is unclear, or if you want to discuss an approach before starting work, open an issue. Tag it with `other` if you want, or just describe what you're trying to do.
