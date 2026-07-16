# AGENTS.md

## Project Overview

`harness-detect` is a Python port of the `@auron-labs/harness-detect` Node package,
the Go package at `github.com/auron/harness-detect/packages/golang/harnessdetect`, and the
`harness-detect` Rust crate. It detects installed LLM harnesses and resolves
their config/state paths from a bundled JSON registry.

- Package entrypoint: `src/harness_detect/__init__.py`
- Canonical registry: `packages/data/harnesses.json`
- Bundled registry copy: `src/harness_detect/data/harnesses.json`
- Tests: `tests/test_behavior.py`
- Package metadata: `pyproject.toml`

## Source-Of-Truth Files

- Package code and exported API: `src/harness_detect/__init__.py`
- Canonical harness matrix data: `packages/data/harnesses.json`
- Bundled harness matrix copy: `src/harness_detect/data/harnesses.json`
- TypeScript harness matrix copy: `packages/typescript/data/harnesses.json`
- Go embedded harness matrix copy: `packages/golang/harnessdetect/data/harnesses.json`
- Rust embedded harness matrix copy: `packages/rust/data/harnesses.json`
- Behavior checks: `tests/test_behavior.py`
- Package metadata: `pyproject.toml`

## Commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, the registry editing procedure, and change-aware
validation. Package-specific commands (run from `packages/python`):

| Purpose | Command |
|---|---|
| Install dev deps | `uv sync --dev` |
| Run tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format check | `uv run ruff format --check .` |
| Format apply | `uv run ruff format .` |
| Build wheel | `uv build` |

There is no root `pyproject.toml`; always `cd` into `packages/python` first.

## Working Rules

- Keep the package dependency-free at runtime. The only runtime dependency is
  the Python standard library (`json`, `os`, `pathlib`, `re`, `importlib`).
  Do not add runtime dependencies without a clear reason.
- Prefer editing `packages/data/harnesses.json` over adding harness-specific
  code paths in `__init__.py`.
- `__init__.py` should stay generic: compute effective roots, expand
  templates, check executables, return results. No `if key == "codex"`
  branches.
- Preserve the current API unless the user asks for a breaking change:
  - `get_raw_harness_data()`
  - `get_harness_matrix()`
  - `list_harnesses()`
  - `get_harness_support(input)`
  - `list_harness_support()`
  - `check_harness(input, options=None)`
  - `detect_harnesses(options=None)`
  - `detect_installed_harnesses(options=None)`
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
  `_with_defaults()` + `_resolve_harness_roots()` in `__init__.py`.
- Use derived roots like `${CODEX_ROOT}` or `${GEMINI_ROOT}` when overrides
  affect default locations; avoid hardcoding `${HOME}/...` when the harness
  has a documented root override.
- After editing the canonical registry, run `mise run registry:sync`, then
  `mise run registry:check`. Do not hand-edit or manually copy derived package
  registries.

## Testing

- The tests in `tests/test_behavior.py` mirror the TypeScript, Go, and Rust
  suites: matrix readability, byte-for-byte sync with the canonical registry,
  alias lookup, env overrides, derived roots, project (`${CWD}`) resolution,
  executable detection (including Windows `PATHEXT`), unresolved-placeholder
  semantics, platform gating, and basic registry schema validation.
- Registry sync changes should also be validated with `bun test` in
  `packages/typescript`, `go test ./...` in `packages/golang`, and
  `cargo test` in `packages/rust` because all package copies must stay
  aligned with `packages/data/harnesses.json`.

## Known Pitfalls

- `packages/data/harnesses.json` is the canonical registry, but the Python
  package bundles `src/harness_detect/data/harnesses.json` and reads it at
  load time via `importlib.resources`; keep that copy, plus the TypeScript,
  Go, and Rust copies, byte-for-byte aligned after registry edits. The
  `test_bundled_data_matches_shared_file` test asserts this.
- The registry uses Node.js platform names (`darwin`, `linux`, `win32`).
  `_current_platform()` in `__init__.py` maps `sys.platform` to this
  convention.
- The package uses `importlib.resources` to locate the bundled JSON, so the
  `data/harnesses.json` file must be included in the wheel build (handled by
  the `force-include` config in `pyproject.toml`).
- Detection is intentionally evidence-based: a harness can count as installed
  from either an executable match or existing config/state paths.
