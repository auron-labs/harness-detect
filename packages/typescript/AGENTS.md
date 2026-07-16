# AGENTS.md

## Project Overview

`@auron-labs/harness-detect` is a small ESM Node package that detects installed LLM harnesses and resolves their config/state paths from a JSON registry.

- Runtime: Node.js `>=18` (`package.json`)
- Source entrypoint: `src/index.js`
- Public types: `index.d.ts`
- Canonical registry/source of truth for harness metadata: `packages/data/harnesses.json`
- Derived package registry copy: `data/harnesses.json`
- Tests: `test/index.test.js`

## Source-Of-Truth Files

- Package metadata and exported entrypoints: `package.json`
- Detection logic and env-root resolution: `src/index.js`
- Canonical harness matrix schema-by-example: `packages/data/harnesses.json`
- Derived package harness matrix copy: `data/harnesses.json`
- Public API surface: `index.d.ts`
- Behavior checks: `test/index.test.js`

## Commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, the registry editing procedure, and change-aware
validation.

## Working Rules

- Keep the package dependency-free unless the change clearly needs otherwise.
- Prefer editing `packages/data/harnesses.json` over adding harness-specific code paths in `src/index.js`.
- `src/index.js` should stay generic: compute effective roots, expand templates, check executables, return results.
- If a harness supports root overrides, model that through effective env-derived roots first, then reference those roots in the JSON templates.
- Preserve the current API unless the user asks for a breaking change:
  - `getRawHarnessData()` (preferred raw-registry accessor)
  - `getHarnessMatrix()`
  - `listHarnesses()`
  - `getHarnessSupport()`
  - `listHarnessSupport()`
  - `checkHarness()`
  - `detectHarnesses()`
  - `detectInstalledHarnesses()`
- Raw-registry APIs, `listHarnesses()`, and detection results that embed
  `harness` now expose required `support` metadata wherever they expose full
  harness definitions.
- `support` is descriptive only. Detection still depends on executable matches
  and existing resolved `paths[]` entries.
- The repo is still unpublished, so prefer a clean aligned API/schema over
  compatibility-only layers. Keep registry `version: 1` unless internal
  tooling truly requires a bump.

## Matrix Editing

See [../../docs/maintainers.md](../../docs/maintainers.md) for the
registry editing rules and post-edit verification. Package-specific
notes:

- Follow [../../docs/harness-guide.md](../../docs/harness-guide.md) for the canonical edit flow: edit `packages/data/harnesses.json`, run `mise run registry:sync`, then `mise run registry:check`.
- `data/harnesses.json` is a derived package copy. Do not hand-edit it.
- CI uses the read-only `mise run registry:check` step to catch drift.

- `paths[].template` supports `${...}` placeholders resolved by `withDefaults()` in `src/index.js`.
- Use derived roots like `${CODEX_ROOT}` or `${GEMINI_ROOT}` when overrides affect default locations; avoid hardcoding `${HOME}/...` when the harness has a documented root override.

## Testing

- The current tests only cover matrix readability, alias lookup, full-registry iteration, and a sample env override case.
- `bun run smoke:fixtures` uses a temporary isolated `HOME`, fake executables, and fake config/state paths inside Docker. It does not install real harnesses.
- If you change root-resolution behavior in `src/index.js`, add or update a focused `node:test` case in `test/index.test.js`.

## Known Pitfalls

- The repo is ESM (`"type": "module"`); use `import`, not `require`.
- The preferred raw-registry API is `getRawHarnessData()`. The `./data` export remains public for backwards compatibility, so schema changes are still effectively API changes.
- Detection is intentionally evidence-based: a harness can count as installed from either an executable match or existing config/state paths.
- The Docker smoke test runs on Linux, so macOS-only harnesses can be skipped there if they have no supported detection surface on that platform.
