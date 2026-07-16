# Support

## Where to ask questions

- **Usage questions / bug reports / feature requests:** open a GitHub issue in this repository
- **Security issues:** follow [SECURITY.md](./SECURITY.md) and report privately

## Supported package expectations

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

- Supported packages:
  - `@auron-labs/harness-detect` on npm, runtime target Node.js `>=18`
  - `github.com/auron/harness-detect/packages/golang/harnessdetect` as a Go module
  - `harness-detect` on crates.io
  - `harness-detect` on PyPI, runtime target Python `>=3.10`
- Source of truth for harness metadata: `packages/data/harnesses.json`
- All package registry copies are derived from that shared registry and must stay byte-for-byte aligned.

## Before opening an issue

> **Privacy:** Detection results can contain absolute usernames, home
> directories, project paths, executable paths, and harness config/state paths
> in `paths` (the resolved paths), `matchedPaths`, and `executablePath`. Redact
> these values before posting logs, telemetry, bug reports, screenshots, or
> analytics.

Please include this sanitized information:

- package name and version
- language/runtime version: Node.js or Bun, Go, Rust, or Python, as applicable
- operating system and platform/architecture
- harness key or alias involved
- expected result and actual result
- sanitized `reasons`
- sanitized summaries of `matchedPaths` and `paths` (resolved paths), such as
  path IDs and whether each path existed; do not paste the paths themselves
- names and redacted values of any environment-root overrides you set (for
  example, `CODEX_HOME=<redacted>`)

Do **not** include full environment dumps, token or secret values, or
unredacted absolute paths, usernames, or project names. Redact values before
posting, including environment-root override values.
