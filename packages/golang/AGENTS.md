# AGENTS.md

## Project Overview

The consumable Go package import path is `github.com/auron/harness-detect/packages/golang/harnessdetect` (module root: `github.com/auron/harness-detect/packages/golang`). It is a Go port of the `@auron-labs/harness-detect` Node package and detects installed LLM harnesses while resolving their config/state paths from an embedded JSON registry.

- Package entrypoint: `harnessdetect/harnessdetect.go`
- Canonical registry: `packages/data/harnesses.json`
- Embedded registry copy: `packages/golang/harnessdetect/data/harnesses.json`
- Tests: `harnessdetect/harnessdetect_test.go`

## Source-Of-Truth Files

- Package code and exported API: `harnessdetect/harnessdetect.go`
- Canonical harness matrix data: `packages/data/harnesses.json`
- Embedded harness matrix copy: `harnessdetect/data/harnesses.json`
- TypeScript harness matrix copy: `packages/typescript/data/harnesses.json`
- Behavior checks: `harnessdetect/harnessdetect_test.go`
- Module metadata: `go.mod`

## Commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, the registry editing procedure, and change-aware
validation.

## Working Rules

- Keep the package dependency-free.
- Prefer editing `packages/data/harnesses.json` over adding harness-specific code paths in `harnessdetect.go`.
- `harnessdetect.go` should stay generic: compute effective roots, expand templates, check executables, return results.
- Preserve the current API unless the user asks for a breaking change:
  - `GetRawHarnessData()` (preferred raw-registry accessor)
  - `GetHarnessMatrix()`
  - `ListHarnesses()`
  - `GetHarnessSupport()`
  - `ListHarnessSupport()`
  - `CheckHarness()`
  - `DetectHarnesses()`
  - `DetectInstalledHarnesses()`
- Raw-registry APIs, `ListHarnesses()`, and detection results that embed
  `Harness` now expose required `Support` metadata wherever they expose full
  harness definitions.
- `Support` is descriptive only. Detection still depends on executable matches
  and existing resolved `paths[]` entries.
- The repo is still unpublished, so prefer a clean aligned API/schema over
  compatibility-only layers. Keep registry `version: 1` unless internal
  tooling truly requires a bump.

## Matrix Editing

See [../../docs/maintainers.md](../../docs/maintainers.md) for the
registry editing rules and post-edit verification. Package-specific
notes:

- Follow [../../docs/harness-guide.md](../../docs/harness-guide.md) for the canonical edit flow: edit `packages/data/harnesses.json`, run `mise run registry:sync`, then `mise run registry:check`.
- `harnessdetect/data/harnesses.json` is a derived embedded copy. Do not hand-edit it.
- CI uses the read-only `mise run registry:check` step to catch drift.

- `paths[].template` supports `${...}` placeholders resolved by `withDefaults()` in `harnessdetect.go`.
- Use derived roots like `${CODEX_ROOT}` or `${GEMINI_ROOT}` when overrides affect default locations.

## Testing

- The tests mirror the TypeScript package's behavior checks: matrix readability, alias lookup, env overrides, path existence, and executable detection.
- Registry sync changes should also be validated with `mise run registry:check` and the relevant package tests because all package copies must stay aligned with `packages/data/harnesses.json`.

## Known Pitfalls

- `packages/data/harnesses.json` is the canonical registry, but the Go binary embeds `packages/golang/harnessdetect/data/harnesses.json`; keep that copy, plus `packages/typescript/data/harnesses.json`, byte-for-byte aligned via `mise run registry:sync` and verify with `mise run registry:check` after registry edits.
- Detection is intentionally evidence-based: a harness can count as installed from either an executable match or existing config/state paths.
