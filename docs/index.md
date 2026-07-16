# harness-detect documentation

Welcome to the documentation for **harness-detect**, a monorepo for detecting
installed LLM harnesses (Codex, Claude Code, Gemini CLI, Cursor, and many others)
and resolving their config/state/install paths from a shared JSON registry.

## What this project is

harness-detect is a data-driven library — not a CLI. It ships in four languages
that read the same harness registry:

- **TypeScript** — `@auron-labs/harness-detect`, an ESM Node.js package
  (`packages/typescript`).
- **Go** — `github.com/auron/harness-detect/packages/golang/harnessdetect`
  (`packages/golang`). A library-only port that embeds the registry into the
  binary.
- **Rust** — `harness-detect` crate (`packages/rust`). A library-only port
  that embeds the registry into the binary via `include_str!`.
- **Python** — `harness-detect` package (`packages/python`). A library-only
  port that bundles the registry and reads it at load time via
  `importlib.resources`.

All four packages expose the same API surface and use the same
detection logic: a harness counts as **installed** when a matching executable is
found on `PATH` **or** one or more known config/state/cache/install/project
paths exist on disk. New registry `support` metadata and support-list APIs are
descriptive only; they do not change detection behavior.

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

Prefer a clean aligned API/schema over backwards-compatibility layers, while
keeping registry `version: 1` unless internal tooling truly requires a bump.

<!-- automd:repo-stats section="harness-count-sentence" -->

The registry currently covers **51 harnesses**.

<!-- /automd -->

## Who uses this

- **Application developers** who need to detect which LLM coding agents are
  installed on a user's machine and resolve their config/state paths.
- **Registry contributors** who add or update harness metadata in the shared
  JSON registry.
- **Package maintainers** who work on the TypeScript, Go, Rust, or Python implementations.

## Quick navigation

| Doc | What it covers |
|---|---|
| [getting-started.md](./getting-started.md) | Prerequisites, install, first run, verification |
| [configuration.md](./configuration.md) | Registry schema, env vars, path templates, defaults, precedence |
| [api.md](./api.md) | Public API surface for supported packages |
| [architecture.md](./architecture.md) | Monorepo layout, detection flow, package boundaries |
| [support-matrix.md](./support-matrix.md) | Generated support table from registry `support` data plus category/scope guidance |
| [harness-guide.md](./harness-guide.md) | Agent-facing workflow for adding or editing harness registry entries |
| [package-guide.md](./package-guide.md) | Package parity and API contract for language implementations |
| [development.md](./development.md) | Local workflow, commands, conventions, registry editing |
| [maintainers.md](./maintainers.md) | Consolidated command reference, registry editing procedure, change-aware validation |
| [testing.md](./testing.md) | Test strategy, commands, smoke tests, fixtures |
| [troubleshooting.md](./troubleshooting.md) | Common problems, symptoms, fixes |

## Recommended reading order

**First-time users:**

1. [getting-started.md](./getting-started.md) — install and run detection
2. [api.md](./api.md) — the public API surface
3. [configuration.md](./configuration.md) — how path resolution and env
   overrides work
4. [support-matrix.md](./support-matrix.md) — how to read global vs local
   support metadata

**Contributors / registry editors:**

1. [development.md](./development.md) — repo layout and registry editing rules
2. [harness-guide.md](./harness-guide.md) — canonical registry editing workflow
3. [configuration.md](./configuration.md) — schema and template syntax
4. [support-matrix.md](./support-matrix.md) — support categories, scopes, and
   evidence expectations in the generated matrix
5. [testing.md](./testing.md) — how to validate changes
6. [troubleshooting.md](./troubleshooting.md) — common pitfalls

`docs/support-matrix.md` is generated from each harness entry's required
`support` metadata in `packages/data/harnesses.json`. After support-data edits,
regenerate it with `mise run docs:support-matrix:generate` or the broader
`mise run docs:generate`, then run `mise run docs:check` to catch stale docs.

## Current known limitations

- **No CLI binary.** The packages are libraries; there is no command-line tool
  to invoke.
- **No Go release artifact.** The Go package is maintained and tested in CI, but
  it is a library module. There is no GoReleaser config, no Homebrew tap, and no
  published binary.
- **Registry sync is command-driven.** The canonical registry
  (`packages/data/harnesses.json`) must be synced to package copies with
  `mise run registry:sync`. Tests assert byte-for-byte alignment.
- **Docker smoke test is unverified locally.** `bun run smoke:fixtures` (Docker)
  has not been confirmed to run successfully in all local environments. CI uses
  the local smoke path (`bun run smoke:fixtures:local`).
- **Root-level bun/go/cargo/uv commands fail.** There is no root
  `package.json`, `go.mod`, `Cargo.toml`, or `pyproject.toml`; all commands
  must run from `packages/typescript`, `packages/golang`, `packages/rust`, or
  `packages/python`.
