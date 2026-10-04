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

Environment variables for development:

- `LANSHARE_HTTP_PORT`: local backend port (default 43821).
- `LANSHARE_LAN_HTTP_PORT`: transfer port (default 43841).
- `LANSHARE_ADMIN_TOKEN`: set by the desktop app when it starts the backend. Without it the local API rejects every request.
- `LANSHARE_LOOPBACK_PEER_HTTP_PORT`: the transfer port of a second local instance, so you can test transfers on one machine.

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

## Commit Messages

Use conventional commit prefixes. The most common in this project:

`feat(area):` — new feature.

`fix(area):` — bug fix.

`chore:` — non-functional change, dependency bump, version bump.

`ci:` — workflow or CI change.

`refactor(area):` — code change that neither fixes a bug nor adds a feature.

## Pull requests:

- Fork the repository and branch from `main`.
- Keep commits focused.
- Describe the change, why it's needed and how you tested it.
- Push follow-up commits to the same branch in response to review. Don't force-push over review comments.

Security reports should not go in public issues. See [SECURITY.md](./SECURITY.md). Accessibility problems are welcome as regular issues. See [ACCESSIBILITY.md](./ACCESSIBILITY.md).

## Review Expectations

If your PR sits without a response for more than two weeks, comment on it with a ping. It may have been missed.

## Changes that are not allowed

- Changes that make identifier casing inconsistent with the conventions above.
- Changes to the release workflow that don't solve a problem.
- Changes that disable or bypass security checks, including the admin token, the path traversal sanitization and others.
- Formatting-only PRs that touch every file. If you want to reformat, do it in a PR that only reformats, and explain why.

## Questions

If something in this document is unclear, or if you want to discuss an approach before starting work, open an issue. Tag it with `other` if you want, or just describe what you're trying to do.
