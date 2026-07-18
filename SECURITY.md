# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for suspected security problems.

- Use this repository's GitHub **Report a vulnerability** / private vulnerability reporting flow.
- Include: affected package/version, impact, reproduction steps, and any proposed mitigation.
- Redact detection-result values before attaching evidence. `paths` (the
  resolved paths), `matchedPaths`, and `executablePath` can contain absolute
  usernames, home directories, project paths, executable paths, and harness
  config/state paths; this also applies to logs, telemetry, bug reports,
  screenshots, and analytics.

We will acknowledge reports as soon as practical and coordinate a fix and disclosure plan privately.

## Scope

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron-labs/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

All four supported distribution targets are covered:

- `@auron-labs/harness-detect` (`packages/typescript`) — npm
- `github.com/auron-labs/harness-detect/packages/golang/harnessdetect` (`packages/golang`) — Go module
- `harness-detect` (`packages/rust`) — Rust crate
- `harness-detect` (`packages/python`) — Python package

The shared registry at `packages/data/harnesses.json` is also in scope since
it is embedded into all four packages.
