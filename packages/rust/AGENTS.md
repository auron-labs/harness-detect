# AGENTS.md

## Project Overview

`harness-detect` is a Rust port of the `@auron-labs/harness-detect` Node package
and the Go package at `github.com/auron/harness-detect/packages/golang/harnessdetect`. It detects
installed LLM harnesses and resolves their config/state paths from an embedded
JSON registry.

- Crate entrypoint: `src/lib.rs`
- Canonical registry: `packages/data/harnesses.json`
- Embedded registry copy: `packages/rust/data/harnesses.json`
- Tests: `tests/behavior.rs` (integration), `src/lib.rs` `#[cfg(test)]` (unit)
- Crate metadata: `Cargo.toml`

## Source-Of-Truth Files

- Crate code and exported API: `src/lib.rs`
- Canonical harness matrix data: `packages/data/harnesses.json`
- Embedded harness matrix copy: `data/harnesses.json`
- TypeScript harness matrix copy: `packages/typescript/data/harnesses.json`
- Go embedded harness matrix copy: `packages/golang/harnessdetect/data/harnesses.json`
- Behavior checks: `tests/behavior.rs`
- Crate metadata: `Cargo.toml`

## Commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, the registry editing procedure, and change-aware
validation. Package-specific commands (run from `packages/rust`):

| Purpose | Command |
|---|---|
| Run tests | `cargo test` |
| Lint | `cargo clippy --all-targets` |
| Format check | `cargo fmt --check` |
| Format apply | `cargo fmt` |
| Build | `cargo build` |

There is no root `Cargo.toml`; always `cd` into `packages/rust` first.

## Working Rules

- Keep the crate dependency-light. The only runtime dependency is `serde` +
  `serde_json` (Rust's stdlib has no JSON support). Do not add further
  dependencies without a clear reason.
- Prefer editing `packages/data/harnesses.json` over adding harness-specific
  code paths in `src/lib.rs`.
- `src/lib.rs` should stay generic: compute effective roots, expand templates,
  check executables, return results. No `if key == "codex"` branches.
- Preserve the current API unless the user asks for a breaking change:
  - `get_raw_harness_data()`
  - `get_harness_matrix()`
  - `list_harnesses()`
  - `get_harness_support(input) -> Result<HarnessSupportRecord, HarnessError>`
  - `list_harness_support()`
  - `check_harness(input, options) -> Result<HarnessCheckResult, HarnessError>`
  - `detect_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`
  - `detect_installed_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`
- Raw-registry APIs, `list_harnesses()`, and detection results that embed a
  full harness definition now expose required `support` metadata wherever they
  expose registry harness entries.
- `support` is descriptive only. Detection still depends on executable matches
  and existing resolved `paths[]` entries.
- The repo is still unpublished, so prefer a clean aligned API/schema over
  compatibility-only layers. Keep registry `version: 1` unless internal
  tooling truly requires a bump.

## Matrix Editing

See [../../docs/maintainers.md](../../docs/maintainers.md) for the
registry editing rules and post-edit verification. Package-specific
notes:

- `paths[].template` supports `${...}` placeholders resolved by
  `with_defaults()` + `resolve_harness_roots()` in `src/lib.rs`.
- Use derived roots like `${CODEX_ROOT}` or `${GEMINI_ROOT}` when overrides
  affect default locations; avoid hardcoding `${HOME}/...` when the harness
  has a documented root override.
- After editing the canonical registry, run `mise run registry:sync`, then
  `mise run registry:check`. Do not hand-edit or manually copy derived package
  registries.

## Testing

- The integration tests in `tests/behavior.rs` mirror the TypeScript and Go
  suites: matrix readability, byte-for-byte sync with the canonical registry,
  alias lookup, env overrides, derived roots, project (`${CWD}`) resolution,
  executable detection (including Windows `PATHEXT`), unresolved-placeholder
  semantics, platform gating, and basic registry schema validation.
- Registry sync changes should also be validated with `bun test` in
  `packages/typescript` and `go test ./...` in `packages/golang` because all
  package copies must stay aligned with `packages/data/harnesses.json`.

## Known Pitfalls

- `packages/data/harnesses.json` is the canonical registry, but the Rust
  binary embeds `packages/rust/data/harnesses.json` via `include_str!`; keep
  that copy, plus `packages/typescript/data/harnesses.json` and
  `packages/golang/harnessdetect/data/harnesses.json`, byte-for-byte aligned
  after registry edits. The `embedded_data_matches_shared_file` test asserts
  this.
- The registry uses Node.js platform names (`darwin`, `linux`, `win32`).
  `current_platform()` in `src/lib.rs` maps Rust `target_os` values to this
  convention.
- Path normalization is a simple forward-slash implementation
  (`normalize_path`) mirroring Go's `filepath.Clean` / Node's `path.normalize`.
  On Windows it does not convert to backslashes; this is an acceptable
  simplification since the registry contains no Windows-only path entries.
- Detection is intentionally evidence-based: a harness can count as installed
  from either an executable match or existing config/state paths.
