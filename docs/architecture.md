# Architecture

## Overview

harness-detect is a monorepo with four library implementations that share one
JSON registry. The design principle is **data-driven detection**: most
new-harness work is a data edit, not a code change.

## Monorepo layout

```
harness-detect/
├── packages/
│   ├── data/
│   │   ├── harnesses.json              # Canonical shared registry (source of truth)
│   │   └── harnesses.schema.json       # JSON Schema (draft 2020-12) for the registry
│   ├── typescript/
│   │   ├── src/
│   │   │   └── index.js                # Detection logic + API
│   │   ├── data/
│   │   │   └── harnesses.json          # TS package copy (must match canonical)
│   │   ├── test/
│   │   │   ├── index.test.js           # Behavior tests
│   │   │   └── types-consumer.ts       # Type-check consumer
│   │   ├── scripts/
│   │   │   └── smoke-fixtures.js       # Hermetic fixture smoke test
│   │   ├── index.d.ts                  # Public TypeScript declarations
│   │   ├── package.json                # Package metadata, scripts, exports
│   │   └── tsconfig.types.json         # tsc --noEmit config
│   ├── golang/
│   │   ├── harnessdetect/
│   │   │   ├── harnessdetect.go         # Detection logic + API
│   │   │   ├── harnessdetect_test.go    # Behavior tests
│   │   │   └── data/
│   │   │       └── harnesses.json      # Go embedded copy (must match canonical)
│   │   └── go.mod                      # Go module declaration
│   ├── rust/
│   │   ├── src/
│   │   │   └── lib.rs                  # Detection logic + API
│   │   ├── data/
│   │   │   └── harnesses.json          # Rust embedded copy (must match canonical)
│   │   ├── tests/
│   │   │   └── behavior.rs             # Integration behavior tests
│   │   └── Cargo.toml                  # Rust crate metadata
│   └── python/
│       ├── src/harness_detect/
│       │   ├── __init__.py              # Detection logic + API
│       │   └── data/
│       │       └── harnesses.json      # Python bundled copy (must match canonical)
│       ├── tests/
│       │   └── test_behavior.py        # Behavior tests
│       └── pyproject.toml              # Python package metadata
├── .github/workflows/ci.yml           # CI pipeline
├── mise.toml                           # mise task shortcuts
├── docs/                               # This documentation
├── README.md
├── CONTRIBUTING.md
├── SUPPORT.md
├── SECURITY.md
├── CHANGELOG.md
└── LICENSE
```

## Package boundaries

| Package | Language | Module | Registry access | Dependencies |
|---|---|---|---|---|
| TypeScript | JS (ESM) | `@auron-labs/harness-detect` | Reads `data/harnesses.json` via relative path at import time | Zero runtime; `typescript` dev-only |
| Go | Go | `github.com/auron/harness-detect/packages/golang/harnessdetect` | Embeds `data/harnesses.json` via `//go:embed` | Zero external |
| Rust | Rust | `harness-detect` | Embeds `data/harnesses.json` via `include_str!` | `serde` + `serde_json` (stdlib has no JSON) |
| Python | Python | `harness-detect` | Bundles `data/harnesses.json`, reads at load time via `importlib.resources` | Zero runtime (stdlib only); `pytest` + `ruff` dev |

Shared data lives only under `packages/data/`. Each package maintains its own
copy that must stay byte-for-byte aligned with the canonical file.

## Detection flow

All four packages follow the same detection algorithm:

```
checkHarness(input, options)
  │
  ├─ 1. Resolve harness definition by key/alias (case-insensitive)
  │     └─ Search matrix.harnesses for matching key or alias
  │
  ├─ 2. Compute base environment (withDefaults)
  │     ├─ Start with options.env (or process.env / os.Environ)
  │     ├─ Fill in HOME, USERPROFILE, XDG_CONFIG_HOME, XDG_DATA_HOME,
  │     │   XDG_STATE_HOME, XDG_CACHE_HOME, TMPDIR, CWD with defaults
  │     └─ Normalize CWD
  │
  ├─ 3. Resolve harness-specific roots (resolveHarnessRoots)
  │     ├─ For each root in harness.roots[] (in declaration order):
  │     │   ├─ If root.env is set and env var has a value:
  │     │   │   ├─ If root.use is set: resolve root.use template
  │     │   │   └─ Else: use env var value directly
  │     │   └─ Else: resolve root.fallback template
  │     └─ Add resolved root names to the env map
  │
  ├─ 4. Find executable (findExecutable)
  │     ├─ Split PATH by delimiter
  │     ├─ On Windows: try each PATHEXT extension
  │     ├─ For each executable name × PATH dir × extension:
  │     │   ├─ Check file exists and is a file
  │     │   └─ On non-Windows: check executable bit (0o111)
  │     └─ Return first match or null/empty
  │
  ├─ 5. Resolve paths (resolvePaths)
  │     ├─ Filter by platform (platformMatches)
  │     ├─ For each path entry:
  │     │   ├─ Resolve template against env (resolveTemplate)
  │     │   │   └─ If any placeholder is unresolved → path = null/empty
  │     │   └─ Check existence (pathTypeMatches: file vs dir)
  │     └─ Return all entries with path + exists
  │
  ├─ 6. Collect matched paths (where exists = true)
  │
  ├─ 7. Build reasons array
  │     ├─ "executable:<basename>" if executable found
  │     └─ "<category>:<id>" for each matched path
  │
  └─ 8. Return result
        ├─ installed = executablePath || matchedPaths.length > 0
        ├─ executablePath
        ├─ paths (all resolved)
        ├─ matchedPaths (exists = true)
        └─ reasons
```

## Template resolution

Path templates use `${VAR_NAME}` syntax. The resolution function:

1. Replaces all `${...}` placeholders with values from the env map.
2. If any placeholder value is undefined, null, or empty → the **entire
   template resolves to null** in public APIs.
3. Normalizes the result (`path.normalize` / `filepath.Clean`).

This means a path like `${Q_CLI_DATA_ROOT}/amazon-q/data.sqlite3` resolves to
null when `Q_CLI_DATA_DIR` is not set (because `Q_CLI_DATA_ROOT`'s fallback is
empty).

## Design constraints

- **Generic code, specific data.** `src/index.js`, `harnessdetect.go`,
  `src/lib.rs`, and `__init__.py` contain no harness-specific logic. All
  harness-specific behavior is encoded in the registry JSON.
- **Registry is public API.** The JSON is exported by the TS package (`./data`
  subpath) and embedded or bundled into package artifacts. Schema changes are
  breaking changes for every package.
- **Keys are immutable.** A harness `key` is part of the public API and must
  never be renamed.
- **Evidence-based detection.** A harness counts as installed from either an
  executable match or existing paths — no version checks, no process
  inspection, no network calls.
- **No side effects.** Detection is read-only: it checks the filesystem and
  PATH. It does not modify anything.

## CI pipeline

`.github/workflows/ci.yml` runs on every push and pull request:

1. Checkout code
2. Setup Bun 1.3.14
3. Install TypeScript dependencies (`bun install --frozen-lockfile`)
4. Check registry drift (`bun scripts/sync-registry.mjs --check`)
5. Check support matrix drift (`node scripts/generate-support-matrix.mjs --check`)
6. Run TypeScript tests, dependency audit, type checks, smoke fixtures, and pack dry-run
7. Check API parity (`bun scripts/check-api-parity.mjs`)
8. Setup Go and run `go test ./...`, `go vet ./...`, and `govulncheck`
9. Check cross-package parity (`bun scripts/check-package-parity.mjs`)
10. Setup Rust and run format check, clippy, tests, and `cargo audit`
11. Setup Python/uv, install dependencies, run ruff lint, format check, pytest, and `pip-audit`
