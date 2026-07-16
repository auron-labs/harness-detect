# AGENTS.md

Root guidance for the `harness-detect` monorepo. Package-specific files under
`packages/*/AGENTS.md` take precedence when editing files inside those packages.
The closest `AGENTS.md` to an edited file always wins.

## Project overview

Multi-package project for detecting installed LLM harnesses (Codex, Claude
Code, Gemini CLI, Cursor, etc.) on a filesystem and resolving their
config/state/install paths. Package implementations share one JSON registry:

- **TypeScript** — `@auron-labs/harness-detect`, ESM Node package (`packages/typescript`).
- **Go** — consumable package import path `github.com/auron/harness-detect/packages/golang/harnessdetect` (`packages/golang`; module root `github.com/auron/harness-detect/packages/golang`).
- **Rust** — `harness-detect` crate (`packages/rust`).
- **Python** — `harness-detect` package (`packages/python`).

Detection is data-driven: a harness counts as installed when an executable
matches or a known config/state path exists. Package implementations read the
same registry, so most new-harness work is a data edit, not a code change.
Support metadata is descriptive only and does not affect detection.

## Source-of-truth files

- Shared harness registry: `packages/data/harnesses.json`
- TypeScript package registry copy: `packages/typescript/data/harnesses.json`
- Go embedded registry copy: `packages/golang/harnessdetect/data/harnesses.json`
- Rust embedded registry copy: `packages/rust/data/harnesses.json`
- Python bundled registry copy: `packages/python/src/harness_detect/data/harnesses.json`
- TypeScript package: `packages/typescript/package.json`, `src/index.js`, `index.d.ts`, `test/index.test.js`
- Go package: `packages/golang/go.mod`, `packages/golang/harnessdetect/harnessdetect.go`, `packages/golang/harnessdetect/harnessdetect_test.go`
- Rust package: `packages/rust/Cargo.toml`, `src/lib.rs`, `tests/behavior.rs`
- Python package: `packages/python/pyproject.toml`, `src/harness_detect/__init__.py`, `tests/test_behavior.py`
- CI: `.github/workflows/ci.yml`
- Project docs entrypoint: `docs/index.md`
- Package guidance: `packages/typescript/AGENTS.md`, `packages/golang/AGENTS.md`, `packages/rust/AGENTS.md`, `packages/python/AGENTS.md`

No root `package.json`, `go.mod`, `Cargo.toml`, or `pyproject.toml` exists.

## Commands

See [docs/maintainers.md](./docs/maintainers.md) for the full command
reference, the registry editing procedure, and change-aware validation.

## Guides

- Documentation home and reading order: `docs/index.md`
- Developer workflow and commands: `docs/development.md`, `docs/maintainers.md`
- Harness registry workflow: `docs/harness-guide.md`
- Package parity/API contract: `docs/package-guide.md`

## Monorepo layout

- `packages/data/harnesses.json` — canonical shared registry.
- `packages/typescript/` — ESM Node package; reads registry via relative path.
  See `packages/typescript/AGENTS.md`.
- `packages/golang/` — Go port; embeds `packages/golang/harnessdetect/data/harnesses.json`.
  See `packages/golang/AGENTS.md`.
- `packages/rust/` — Rust port; embeds `packages/rust/data/harnesses.json`.
  See `packages/rust/AGENTS.md`.
- `packages/python/` — Python port; bundles `packages/python/src/harness_detect/data/harnesses.json`.
  See `packages/python/AGENTS.md`.

Boundaries: shared data lives only under `packages/data/`. Each package's own
`AGENTS.md` documents its working rules, API surface, and matrix-editing notes.

## Known pitfalls

- **Root package-manager commands fail.** There is no root `package.json`,
  `go.mod`, `Cargo.toml`, or `pyproject.toml`. Always run package-native
  commands from the relevant package directory.
- **CI runs package-scoped commands.** `.github/workflows/ci.yml` runs
  TypeScript commands from `packages/typescript` and Go commands from
  `packages/golang` via `working-directory`; mirror those package directories
  locally because the repo root still has no `package.json` or `go.mod`.
- **Registry sync is command-driven.** Edit only `packages/data/harnesses.json`,
  then run `mise run registry:sync`. Do not hand-edit
  `packages/typescript/data/harnesses.json` or
  `packages/golang/harnessdetect/data/harnesses.json`.
- **CI uses read-only registry enforcement.** `mise run registry:check`
  verifies generated package copies stay byte-for-byte aligned with
  `packages/data/harnesses.json`.
- **Docker smoke is unverified.** `bun run smoke:fixtures` (Docker-based) has
  not been confirmed to run successfully locally. `bun run smoke:fixtures:local`
  is verified and is what CI uses.
- **Registry is public API.** Raw-registry APIs, harness-list APIs, and
  detection results that embed full harness definitions now include required
  `support` metadata wherever they expose registry harness entries. Prefer the
  runtime raw-registry APIs over package-local JSON access when documenting
  package usage.
- **Pre-publication compatibility policy.** The repo has not been published yet,
  so prefer a clean aligned API/schema over compatibility-only layers. Keep
  registry `version: 1` unless internal tooling truly requires a bump.
