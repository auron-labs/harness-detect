# Package implementation guide

This guide defines the minimum contract for adding a new package implementation
 to this repository. A package is not considered equivalent to the existing
 TypeScript, Go, Rust, and Python packages until it satisfies the API, result-shape, parity,
 performance, CI, and documentation requirements below. For the current
 documentation map, start at `docs/index.md`; keep `docs/api.md`,
 `docs/testing.md`, `docs/development.md`, and `docs/maintainers.md` aligned
 with any package changes.

## 1. Source of truth and package data

1. `packages/data/harnesses.json` is the only canonical harness registry.
2. New packages must read that shared registry directly unless the language's
   packaging/runtime model requires a package-local derived copy.
3. If a package-local copy is required:
   - treat it as a derived artifact, never as an editing surface;
   - keep it byte-for-byte identical to `packages/data/harnesses.json`;
   - add the package to the registry sync flow so `mise run registry:check`
     fails when the copy drifts.
4. Detection logic must stay data-driven. Do not add harness-specific detection
   branches when the behavior can be modeled in the shared registry.

## 2. Required public API

Every package must expose the same eight public operations already locked by
 `testdata/public-api-parity.json`:

1. raw registry accessor
   - TypeScript: `getRawHarnessData` (preferred raw-registry API)
   - Go: `GetRawHarnessData` (preferred raw-registry API)
   - Rust: `get_raw_harness_data` (preferred raw-registry API)
   - Python: `get_raw_harness_data` (preferred raw-registry API)
2. compatibility alias for the raw registry accessor
   - TypeScript: `getHarnessMatrix`
   - Go: `GetHarnessMatrix`
   - Rust: `get_harness_matrix`
   - Python: `get_harness_matrix`
3. list harness definitions
   - TypeScript: `listHarnesses`
   - Go: `ListHarnesses`
   - Rust: `list_harnesses`
   - Python: `list_harnesses`
4. get support metadata for one harness by key or alias
   - TypeScript: `getHarnessSupport`
   - Go: `GetHarnessSupport`
   - Rust: `get_harness_support`
   - Python: `get_harness_support`
5. list support metadata for every harness
   - TypeScript: `listHarnessSupport`
   - Go: `ListHarnessSupport`
   - Rust: `list_harness_support`
   - Python: `list_harness_support`
6. check one harness by key or alias
   - TypeScript: `checkHarness`
   - Go: `CheckHarness`
   - Rust: `check_harness`
   - Python: `check_harness`
7. detect all harnesses
   - TypeScript: `detectHarnesses`
   - Go: `DetectHarnesses`
   - Rust: `detect_harnesses`
   - Python: `detect_harnesses`
8. detect only installed harnesses
   - TypeScript: `detectInstalledHarnesses`
   - Go: `DetectInstalledHarnesses`
   - Rust: `detect_installed_harnesses`
   - Python: `detect_installed_harnesses`

Public naming may be idiomatic per language, but the operation set and behavior
 must stay equivalent. Prefer a clean aligned cross-language API over adding
compatibility-only layers.

## 3. Required data and result contract

The package must preserve the shared registry schema and the JSON/result fields
 locked in `testdata/public-api-parity.json`.

### Registry-returning APIs

1. The raw-registry accessor must return the full registry object with:
   - `version`
   - `harnesses`
2. Each harness definition must preserve these fields:
    - `key`
    - `name`
    - `aliases`
    - `executables`
    - `installations`
    - `paths`
    - `roots`
    - `env`
    - `sources`
    - `support`
 3. Raw-registry, harness-list, and detection-result `harness` surfaces must
    expose `support` anywhere they expose a full harness definition.
 4. `getHarnessSupport`/`GetHarnessSupport` and
    `listHarnessSupport`/`ListHarnessSupport` must expose the support subset
    only.
 5. `getHarnessMatrix`/`GetHarnessMatrix` must remain a compatibility alias for
    the raw-registry accessor, not a divergent data shape.

### Detection APIs

`checkHarness`/`CheckHarness`, `detectHarnesses`/`DetectHarnesses`, and
`detectInstalledHarnesses`/`DetectInstalledHarnesses` must return results with
 these semantics:

1. `installed` is `true` when either:
   - a configured executable is found on `PATH` and is executable where the
     platform requires that check; or
   - one or more configured paths exist on disk with the expected file/dir kind.
2. `executablePath` is nullable:
   - use `null` in JSON-capable languages;
   - use the language's explicit nullable representation in memory when needed;
   - when serialized to JSON, the field must still become `null` when no
     executable matched.
3. Each resolved path entry must include:
   - the original path metadata;
   - `path`, which is nullable when placeholders cannot be resolved;
   - `exists`, which is `false` when `path` is unresolved or missing on disk.
4. `paths` contains every resolved, platform-applicable path entry, including
   non-existent entries.
5. `matchedPaths` is the subset of `paths` where `exists == true`.
6. `reasons` must explain installation using the current parity format:
   - `executable:<basename>` for executable matches;
   - `<category>:<id>` for matched paths.
7. Support metadata must not affect installation outcomes; detection semantics
   stay executable/path based.
8. Unknown harness lookup must fail with `Unknown harness: <input>` semantics.
9. Key/alias lookup must be case-insensitive and trim surrounding whitespace.
10. Project-relative paths must use the explicit `cwd` option or the process
    working directory when that option is omitted. They must not read a `CWD`
    environment variable as the source of truth.

## 4. Clone and immutability requirements

1. Raw-registry and list APIs must return defensive deep copies.
2. Callers must be able to mutate the returned objects/slices/arrays without
   mutating package-global state or affecting later calls.
3. Deep-copy protection applies to nested arrays/collections as well as the
   top-level registry object.

## 5. Minimum behavioral parity tests

A new package must add package-local tests that cover the same public contract
 already enforced in TypeScript and Go:

1. registry copy matches the shared registry byte-for-byte when the package uses
   a local derived copy;
2. raw-registry API returns a defensive deep clone;
3. compatibility alias returns the same data as the raw-registry API;
4. list API length matches the registry harness count;
5. support lookup/list APIs return deep-copied support metadata that matches
   the canonical registry;
6. env-root override resolution;
7. derived-root resolution from `roots[]`;
8. key and alias resolution parity;
9. full-registry detection count parity;
10. installed-only detection equals `detect-all` filtered to installed results;
11. unknown harness failure semantics;
12. unresolved placeholder => nullable path semantics;
13. project-path/CWD semantics;
14. platform-gated path inclusion on matching platforms;
15. path-only install detection;
16. executable-only install detection;
17. non-executable PATH entries do not count as executable matches where
     applicable;
18. reasons and matched-path reporting.

## 6. Cross-package parity fixtures

The repository already defines the shared equivalence contract in:

1. `testdata/public-api-parity.json` — public API names and core field mapping.
2. `testdata/package-parity-cases.json` — hermetic behavior fixtures.

When a future feature adds a shared registry field or other cross-package
observable behavior, extend the existing repo-level parity runner/fixtures
instead of duplicating equivalent assertions separately in each package. If the
repo-level parity runner does not exist yet for that feature area, keep the
coverage package-local and use the explicit `mise run registry:sync` /
`mise run registry:check` workflow until shared parity automation is available.

Additive schema/API work should default to the clean aligned contract. Keep
registry `version: 1` unless internal tooling needs a document-version bump; do
not bump just because raw harness entries gained additive `support` metadata.

Any new package implementation must:

1. participate in the API parity manifest, not replace it with package-specific
   expectations;
2. run against the same hermetic parity fixture cases used by the other
   packages;
3. match the existing packages' observable results for those cases, including
   nullability and JSON field names;
4. extend the parity tooling if needed so repo-level parity checks fail when the
   new package diverges.

## 7. Performance expectations

Performance is part of equivalence. A new package must provide a hermetic perf
 command that:

1. runs detection repeatedly in an isolated temp environment;
2. validates result count on warmup and each iteration;
3. prints a simple machine-readable or grep-friendly summary including
   iterations, elapsed time, and throughput/ops-per-second;
4. avoids network access and real harness installs;
5. is wired into repo-level mise perf tasks.

The goal is not identical runtime across languages. The contract is that every
 package has a maintained perf smoke/benchmark so regressions can be measured
 under comparable hermetic conditions.

## 8. CI and mise integration

Before a package can be treated as first-class, it must be wired into repo
 automation.

Required integration:

1. package-scoped test command(s);
2. any language-native validation required to prove the exported API surface
   compiles or type-checks;
3. registry sync enforcement when the package uses a local derived registry
   copy;
4. API parity checks;
5. package parity checks;
6. perf task(s);
7. inclusion in the relevant root `mise.toml` tasks, and in CI where the repo
   verifies release readiness.

Do not rely on undocumented local commands. If a package is required for
 equivalence, its commands must exist in `mise.toml` and be runnable in CI.

## 9. Documentation updates required for a new package

Adding a package is incomplete until docs are updated to describe it.

Minimum required updates:

1. `docs/index.md` and `docs/architecture.md` — package list, repository
   layout, and reader navigation.
2. `docs/api.md` — package entrypoint, exported API names, and type/result
   shape.
3. `docs/testing.md` — package test commands and the package's local contract
   tests.
4. `docs/development.md` and `docs/maintainers.md` — package commands and any
    sync/validation workflow.
5. `docs/support-matrix.md` — generated support matrix plus cross-cutting
    category/scope guidance and maintainer workflow when package-visible
    support APIs change.
6. root `AGENTS.md` and package-local `AGENTS.md` — package rules,
    source-of-truth files, and
    verification commands.
7. any package metadata or installation docs affected by the new
   language/runtime.

Package READMEs should stay focused on package-local install and API examples.
Cross-cutting explanations of support categories, global vs local semantics, and
registry authoring rules belong in `docs/`. The support matrix doc is generated
from registry `support` data, so support-surface changes should also mention the
`docs:support-matrix:generate` / `docs:check` workflow in maintainer-facing
docs.

## 10. Definition of package equivalence

A future package is equivalent to TypeScript and Go only when all of the
 following are true:

1. it uses the shared registry contract from `packages/data/harnesses.json`;
2. any package-local registry copy is derived and sync-enforced;
3. it exposes the same eight public operations;
4. its registry, result fields, null semantics, and JSON shape match the parity
   manifest;
5. its returned registry/list values are defensive deep copies;
6. its behavior matches the shared hermetic parity fixtures;
7. it has local tests for the same behavioral contract areas as the existing
   packages;
8. it has a hermetic perf command wired into mise;
9. it is included in repo-level automation and CI;
10. the maintainer and API/testing docs have been updated to include it.

If any item above is missing, the package is experimental, not equivalent.
