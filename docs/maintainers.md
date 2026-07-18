# Maintainer reference

Single source of truth for build/test commands, the registry editing
procedure, and change-aware validation. Other docs and `AGENTS.md` files
link here instead of duplicating this content. Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron-labs/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

Compatibility policy: prefer a clean aligned API/schema over backwards
compatibility layers, and keep registry `version: 1` unless internal tooling
truly needs a document-version bump.

## Commands

Run each command from the working directory shown. The repo root has no
`package.json`, `go.mod`, `Cargo.toml`, or `pyproject.toml`, so root-level
package-manager commands fail.

### TypeScript (`packages/typescript`)

| Purpose | Command |
|---|---|
| Run tests | `bun test` |
| Type-check declarations | `bun run types:check` |
| Local hermetic smoke test | `bun run smoke:fixtures:local` |
| Docker smoke test | `bun run smoke:fixtures` |
| Hermetic perf smoke (reporting only) | `node scripts/perf-smoke.js` |
| Dry-run package contents | `bun pm pack --dry-run` *(runs `prepack`, which may resync derived registry copies if they drift)* |
| Dependency audit | `bun audit` |
| One-off detection sample | `node --input-type=module -e "import { detectHarnesses } from './src/index.js'; console.log(detectHarnesses().filter(r => r.installed).map(r => r.key))"` |

### Go (`packages/golang`)

| Purpose | Command |
|---|---|
| Run tests | `go test ./...` |
| Vet | `go vet ./...` |
| Vulnerability check | `go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...` |
| Hermetic benchmark report (reporting only) | `go test -run '^$' -bench BenchmarkDetectHarnesses -benchmem ./harnessdetect` |
| External local consumer check | `mise run go:consumer` |

### Rust (`packages/rust`)

| Purpose | Command |
|---|---|
| Run tests | `cargo test` |
| Lint | `cargo clippy --all-targets` |
| Format check | `cargo fmt --check` |
| Dependency audit | `cargo install cargo-audit --locked && cargo audit` |
| Hermetic perf smoke (reporting only) | `cargo run --quiet --release --example perf_smoke` |
| Package crate without publishing | `cargo package --allow-dirty` |

### Python (`packages/python`)

| Purpose | Command |
|---|---|
| Install dev deps | `uv sync --dev` |
| Run tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format check | `uv run ruff format --check .` |
| Dependency audit | `uv run --with pip-audit pip-audit` |
| Hermetic perf smoke (reporting only) | `uv run python scripts/perf_smoke.py` |
| Build wheel and source distribution without publishing | `uv build` |

### mise shortcuts (from repo root)

| Purpose | Command |
|---|---|
| Package tests | `mise run test` |
| Local smoke test | `mise run smoke` (or `mise run smoketest`) |
| Docker smoke test | `mise run smoke:docker` (or `mise run smoketest:docker`) |
| Full release verification | `mise run verify` |
| Package perf reports | `mise run perf` |
| Dependency/security audit | `mise run security:audit` |
| Registry sync check | `mise run registry:check` |
| Regenerate generated docs | `mise run docs:generate` |
| Regenerate support matrix only | `mise run docs:support-matrix:generate` |
| Print support leaf totals | `node scripts/generate-support-matrix.mjs --summary` |
| Check support matrix freshness | `mise run docs:support-matrix:check` |
| Check all generated docs freshness | `mise run docs:check` |
| TypeScript type-check | `mise run ts:types` |
| npm package contents dry-run | `mise run ts:pack` |
| Go external local consumer check | `mise run go:consumer` |
| Rust crate package check | `mise run rust:package` |
| Python wheel/sdist build | `mise run python:build` |
| List all tasks | `mise tasks` |

### No lint, build, or format scripts

No `bun run lint`, `bun run build`, or `bun run format` scripts are
configured. Do not invent them. The TypeScript package is runtime
dependency-free and does not require a build step.

## CI-equivalent verification order

The direct command order documented in `.github/workflows/ci.yml` is:

1. `cd packages/typescript && bun install --frozen-lockfile`
2. `bun scripts/sync-registry.mjs --check`
3. `node scripts/generate-support-matrix.mjs --check`
4. `cd packages/typescript && bunx automd --dir ../..`
5. `git diff --exit-code -- README.md docs/index.md docs/api.md docs/configuration.md`
6. `cd packages/typescript && bun test`
7. `cd packages/typescript && bun audit`
8. `cd packages/typescript && bun run types:check`
9. `cd packages/typescript && bun run smoke:fixtures:local`
10. `cd packages/typescript && bun pm pack --dry-run`
11. `bun scripts/check-api-parity.mjs`
12. `cd packages/golang && go test ./...`
13. `cd packages/golang && go vet ./...`
14. `node scripts/check-go-consumer.mjs`
15. `cd packages/golang && go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...`
16. `cd packages/rust && cargo fmt --check`
17. `cd packages/rust && cargo clippy --all-targets`
18. `cd packages/rust && cargo test`
19. `cd packages/rust && cargo package --allow-dirty`
20. `cd packages/rust && cargo install cargo-audit --locked && cargo audit`
21. `cd packages/python && uv sync --dev --frozen`
22. `bun scripts/check-package-parity.mjs`
23. `cd packages/python && uv run ruff check .`
24. `cd packages/python && uv run ruff format --check .`
25. `cd packages/python && uv run pytest`
26. `cd packages/python && uv build`
27. `cd packages/python && uv run --with pip-audit pip-audit`

`mise run verify` mirrors that release verification sequence from the repo root,
minus the initial frozen TypeScript install step, with `mise run docs:check`
covering generated-doc freshness before the package suites, and with the local
pre-publication package checks documented below. The audit steps may download
scanner tools into local tool caches. Support-matrix freshness is part of the
normal required verification path, not an optional post-processing step. In
that sequence, the registry drift check runs before `bun pm pack --dry-run`;
only explicit `registry:sync` and `prepack` should rewrite the derived package
registry copies.

Performance comparisons are reporting-only. Use `mise run perf` to collect the
package perf smoke/benchmark output, but do not treat cross-runtime wall-clock
numbers as a strict pass/fail gate in CI.

## Pre-publication package validation

These local checks validate distributable artifacts and consumer-facing package
boundaries before publication. They do not publish packages, query publication
status, or install packages from a remote registry.

| Distribution | Command | What it validates |
|---|---|---|
| npm | `mise run ts:pack` (or `cd packages/typescript && bun pm pack --dry-run`) | Files included in the npm tarball and `prepack` behavior. |
| Go module | `mise run go:consumer` | A deterministic temporary module imports the local module through a `replace` directive and executes its public API. The temporary directory is removed after the check. |
| crates.io | `mise run rust:package` (or `cd packages/rust && cargo package --allow-dirty`) | The crate can be packaged locally without publishing. |
| PyPI | `mise run python:build` (or `cd packages/python && uv build`) | A wheel and source distribution can be built locally without publishing. |

`mise run verify` includes all four checks. Rust and Python package commands
write their normal local build outputs (`target/package/` and `dist/`);
neither output is published by these checks.

## Partial release recovery

If one ecosystem publish job fails, use `workflow_dispatch` to retry only that
ecosystem with the exact `version` and `tag` from the GitHub Release/manifest.
Never republish a version that already succeeded; if an immutable registry
version is bad, publish a corrective patch version instead.

## Editing the harness registry

The registry is the canonical source of truth. Most new-harness work is
a data edit, not a code change.

### Source-of-truth files

| File | Role |
|---|---|
| `packages/data/harnesses.json` | Canonical shared registry |
| `packages/typescript/data/harnesses.json` | TS package copy (must match canonical) |
| `packages/golang/harnessdetect/data/harnesses.json` | Go embedded copy (must match canonical) |
| `packages/rust/data/harnesses.json` | Rust embedded copy (must match canonical) |
| `packages/python/src/harness_detect/data/harnesses.json` | Python bundled copy (must match canonical) |

### Registry editing rules

Schema:

```json
{
  "version": 1,
  "harnesses": [
    {
      "key": "codex",
      "name": "OpenAI Codex CLI",
      "aliases": ["openai/codex"],
      "executables": ["codex"],
      "installations": [
        {
          "method": "npm",
          "package": "@openai/codex",
          "command": "npm install -g @openai/codex",
          "platforms": ["darwin", "linux", "win32"]
        }
      ],
      "paths": [
        { "id": "config", "category": "config", "kind": "file", "template": "${CODEX_ROOT}/config.toml" }
      ],
      "env": [
        { "name": "CODEX_HOME", "description": "Moves the main Codex home/config root." }
      ],
      "sources": ["https://developers.openai.com/codex/cli"]
    }
  ]
}
```

1. Edit `packages/data/harnesses.json` only.
2. `key` must be stable and lowercase. **Never rename an existing key** —
    it is part of the public API of every package.
3. Required fields per entry: `key`, `name`, `aliases`, `executables`,
     `installations`, `paths`, `env`, `sources`, and `support`. All entries
     must have every field (use empty arrays if needed).
4. `support` must include `config`, `skills`, `commands`, `agents`, and
     `dotAgents`, each with `global` and `local` leaves.
5. Add at least one evidence URL in `sources` for every path/executable
     rule you add or change. Prefer documented config/state/install paths
     over guesses.
6. If a path cannot be verified, omit it. If the install method is real but
     underspecified, use `{"method":"unknown"}` plus a short `notes` entry
     instead of guessing a package manager or marketplace ID.
7. Use derived env roots (`roots[]`) when a harness documents a root
     override. Avoid hardcoding `${HOME}/...` when the harness has a
     documented override.
8. For `support.local`, model paths as project/workspace-scoped and anchor them
       to `${CWD}` when the upstream surface is local to a repo.
9. Unknown support data must be explicit once `support` exists: use
       `status: "unknown"`, `confidence: "unknown"`, and empty `paths` /
       `sources` arrays rather than omitting categories or scopes.
10. Treat registry `support` leaves as the support-doc scouting source of truth:
      verify official docs or upstream source per harness, then update
      `status` / `paths` / `sources` / `confidence` / `notes` on the matching
      leaf directly in `packages/data/harnesses.json`.
11. Support-doc scouting can land incrementally. Prioritize the highest-use
      harnesses first, improve `support.*.*.sources` / `confidence` / `notes`
      where you have evidence, and keep the rest visibly `unknown` instead of
      filling gaps with guesses.
12. Top-level `version` is required (currently `1`). Do not bump it just
       because harness definitions gained additive `support` metadata.
13. If support coverage or wording changes, update `packages/data/harnesses.json`,
      regenerate `docs/support-matrix.md`, and refresh any affected
      API/configuration docs in the same change.

### Support metadata fields (`support`)

`support` is public additive metadata. It does not affect installation
detection. Raw-registry APIs, harness-list APIs, and detection results that
embed a full harness definition now expose it wherever they expose registry
harness entries. Dedicated support APIs return only `{key, name, support}`.

Required shape when present:

- Categories: `config`, `skills`, `commands`, `agents`, `dotAgents`
- Scopes per category: `global`, `local`
- Required leaf fields: `status`, `paths`, `sources`, `confidence`
- Optional leaf field: `notes`

Allowed enums:

- `status`: `supported`, `unsupported`, `unknown`
- `confidence`: `official`, `source`, `observed`, `inferred`, `unknown`

Support path entries reuse the existing path vocabulary where possible, but do
not include `category`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable identifier within the support leaf. |
| `kind` | string | yes | `file` or `dir`. |
| `template` | string | yes | Same `${VAR}` template rules as `paths[]`. |
| `platforms` | string[] | no | Same approved platform enum as the rest of the registry. |
| `description` | string | no | Short factual qualifier. |

Scope meaning:

- `global` = user-level/machine-level support outside a project.
- `local` = local/project/workspace support rooted at `${CWD}`.

### Installation metadata fields (`installations[]`)

`installations[]` is public registry metadata consumed by the raw registry APIs
in all four packages (TypeScript `getRawHarnessData()`, Go
`GetRawHarnessData()`, Rust `get_raw_harness_data()`, Python
`get_raw_harness_data()`) and by the TypeScript `@auron-labs/harness-detect/data`
export. Treat additive fields here the same way as `support`: update docs and
note the schema/registry surface in release notes when publication begins.

Strict consumers are part of the compatibility audience here: if downstream
code validates or decodes the raw JSON with a closed object shape, call out new
additive public fields in release/docs notes so those consumers can loosen their
parsing before upgrading. Prefer the clean aligned shape and avoid
compatibility-only shims.

| Field | Type | Required | Notes |
|---|---|---|---|
| `method` | string | yes | One of `npm`, `homebrew`, `pip`, `pipx`, `uv`, `cargo`, `go`, `script`, `manual`, `marketplace`, `binary`, `unknown`. |
| `package` | string | no | Package name when the method is package-manager based. |
| `command` | string | no | Documented install command, when useful. |
| `url` | string | no | Upstream download or install URL. |
| `marketplace` | string | no | Marketplace namespace (for example an editor extension gallery). |
| `id` | string | no | Marketplace or package identifier when upstream documents it. |
| `platforms` | string[] | no | Use only schema-approved `process.platform` values: `aix`, `android`, `cygwin`, `darwin`, `freebsd`, `haiku`, `linux`, `netbsd`, `openbsd`, `sunos`, `win32`. |
| `notes` | string | no | Short factual qualifier; do not speculate. |

Installation metadata is descriptive, not detection evidence. A harness still
counts as installed only from executable matches and/or existing `paths[]`
entries.

Codex npm example:

```json
{
  "key": "codex",
  "name": "OpenAI Codex CLI",
  "aliases": ["openai/codex"],
  "executables": ["codex"],
  "installations": [
    {
      "method": "npm",
      "package": "@openai/codex",
      "command": "npm install -g @openai/codex",
      "platforms": ["darwin", "linux", "win32"]
    }
  ],
  "paths": [
    { "id": "config", "category": "config", "kind": "file", "template": "${CODEX_ROOT}/config.toml" }
  ],
  "env": [
    { "name": "CODEX_HOME", "description": "Moves the main Codex home/config root." }
  ],
  "sources": ["https://developers.openai.com/codex/cli"]
}
```

### After editing the registry

1. Sync the canonical registry into package copies:

```sh
mise run registry:sync
```

This is the only supported sync flow. Do not hand-edit derived package copies.

2. Run tests:

```sh
cd packages/typescript && bun test
cd packages/golang && go test ./...
cd packages/rust && cargo test
cd packages/python && uv run pytest
```

3. Verify sync:

```sh
mise run registry:check
```

4. Refresh docs when needed:

```sh
mise run docs:generate
```

`docs:generate` updates the env-var table in `docs/configuration.md`, generated
`docs/support-matrix.md`, and Automd repository stats. To verify generated docs
are current, run:

```sh
mise run docs:check
```

For support scouting specifically, use the generated matrix as the live progress
report instead of a separate checklist:

1. Verify official docs or upstream source for a harness support surface.
2. Update the matching `support.*.*` leaf in `packages/data/harnesses.json`.
3. Run `mise run registry:sync` if the canonical registry changed.
4. Run `node scripts/generate-support-matrix.mjs --summary`.
5. Use the printed `supported` / `unsupported` / `unknown` totals — especially
   the remaining `unknown` count — to track progress.
6. Leave unverified leaves explicit as `unknown` rather than maintaining a
   side checklist or guessing support.

## Change-aware validation

| What changed | Commands to run |
|---|---|
| Registry only (`packages/data/harnesses.json`) | `mise run registry:sync`, then `bun test` (TS) + `go test ./...` (Go), then `mise run registry:check` |
| Support metadata or support docs | `mise run registry:sync` if registry changed, `node scripts/generate-support-matrix.mjs --summary`, `mise run docs:check`, then targeted doc review of `docs/support-matrix.md`, `docs/api.md`, and `docs/configuration.md`; verify every non-`unknown` support leaf still has evidence URLs plus a non-`unknown` confidence, and use the printed `unknown` total as the progress tracker |
| TypeScript code (`src/*.js`) | `bun test`; if detection behavior changed, also `bun run smoke:fixtures:local`; if API changed, update `index.d.ts` |
| Go code (`*.go`) | `go test ./...` + `go vet ./...` |
| Before final handoff | Full TS suite + local smoke from `packages/typescript` |
