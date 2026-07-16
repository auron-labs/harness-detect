# Configuration

harness-detect is data-driven. The primary configuration source is the **harness
registry** — a JSON file that declares every known harness, its executables,
path templates, environment variable overrides, support metadata, install
metadata, and source URLs. There are no runtime config files, no CLI flags,
and no settings files.

For a support-focused reader's view of the registry, see
[support-matrix.md](./support-matrix.md).
That document is generated from each harness entry's required `support`
metadata in `packages/data/harnesses.json`.

## Configuration files

| File | Role | Read by |
|---|---|---|
| `packages/data/harnesses.json` | Canonical shared registry (source of truth) | Tests only — all package copies must match this byte-for-byte |
| `packages/typescript/data/harnesses.json` | TypeScript package copy | `src/index.js` at import time |
| `packages/golang/harnessdetect/data/harnesses.json` | Go embedded copy | `harnessdetect.go` via `//go:embed` |
| `packages/rust/data/harnesses.json` | Rust embedded copy | `src/lib.rs` via `include_str!` |
| `packages/python/src/harness_detect/data/harnesses.json` | Python bundled copy | `__init__.py` via `importlib.resources` |

The TypeScript package also exports its registry copy as a public subpath:
`@auron-labs/harness-detect/data`.

### Other config files in the repo

| File | Purpose |
|---|---|
| `packages/typescript/package.json` | Package metadata, scripts, exports, engines |
| `packages/typescript/tsconfig.types.json` | TypeScript type-check config (`tsc --noEmit`) |
| `packages/golang/go.mod` | Go module declaration (`go 1.26.4`, no deps) |
| `packages/rust/Cargo.toml` | Rust crate metadata (`serde` + `serde_json` deps) |
| `packages/python/pyproject.toml` | Python package metadata (stdlib-only runtime; `pytest` + `ruff` dev) |
| `mise.toml` | mise task definitions (root-level shortcuts) |
| `.github/workflows/ci.yml` | CI pipeline |

## Registry schema

A machine-checked JSON Schema (draft 2020-12) is published at
`packages/data/harnesses.schema.json` and is enforced by all packages'
test suites. The registry is a single JSON document:

```json
{
  "version": 1,
  "harnesses": [ ... ]
}
```

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | number | yes | Schema version. Currently `1`; keep it there unless internal tooling truly requires a document-version bump. |
| `harnesses` | array | yes | Array of harness definition objects. |

### Harness definition fields

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | Stable, lowercase identifier. Part of the public API — never rename. |
| `name` | string | yes | Human-readable harness name. |
| `aliases` | string[] | yes | Alternative lookup names (e.g. `"claude"` for `claude-code`). May be empty. |
| `executables` | string[] | yes | Executable names to search for on `PATH`. May be empty (path-only detection). |
| `paths` | object[] | yes | Path templates to check. May be empty (executable-only detection). |
| `roots` | object[] | no | Derived template variables resolved before paths. |
| `env` | object[] | yes | Documented environment variables. May be empty. |
| `sources` | string[] | yes | Evidence URLs for the path/executable rules. |
| `support` | object | yes | Required additive support metadata contract. Every category and both scopes must be explicit. |
| `installations` | object[] | yes | Descriptive install metadata only; not detection evidence. |

### Support metadata fields (`support`)

`support` is additive public registry metadata. It does **not** affect installed
status. It documents whether a harness supports specific features at two
scopes. Because the project is still pre-publication, this field was added by
aligning the clean public shape directly instead of adding compatibility
layers.

- `global`: user-level or machine-level support outside a specific workspace.
- `local`: project/workspace-local support rooted at `${CWD}`. In user-facing
  docs, describe this scope as **local/project**.

That `local` meaning is shared across `config`, `skills`, `commands`, `agents`,
and `dotAgents`: if a harness stores those surfaces inside a repo or workspace,
model them under `support.<category>.local` and anchor the paths to `${CWD}`
when the upstream layout is project-relative.

Every harness must include `support`, and it must include all categories and
both scopes explicitly. Do not omit a leaf because the data is missing — encode
the uncertainty with `status: "unknown"`, `confidence: "unknown"`, and empty
`paths` / `sources` arrays.

| Field | Type | Required | Description |
|---|---|---|---|
| `config` | object | yes | Support status for config files/directories. |
| `skills` | object | yes | Support status for skills/prompts directories or files. |
| `commands` | object | yes | Support status for slash commands, command packs, or equivalent command files. |
| `agents` | object | yes | Support status for agent definitions or agent manifests. |
| `dotAgents` | object | yes | Support status for `.agents`-style support surfaces when distinct from `agents`. |

Each category object must contain both scopes:

| Field | Type | Required | Description |
|---|---|---|---|
| `global` | object | yes | Global/user-level support leaf. |
| `local` | object | yes | Local/project-scoped support leaf rooted at `${CWD}`. |

Each support leaf must use this shape:

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | yes | One of `supported`, `unsupported`, `unknown`. |
| `paths` | object[] | yes | Path definitions for the support surface. Use an empty array when none are known or applicable. |
| `sources` | string[] | yes | Evidence URLs supporting this leaf. Use an empty array only when the leaf is `unknown` or there is no direct source for an `observed`/`inferred` entry. |
| `confidence` | string | yes | One of `official`, `source`, `observed`, `inferred`, `unknown`. |
| `notes` | string | no | Short factual qualifier. |

Support path entries intentionally reuse the main registry path vocabulary where
possible:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable path identifier within the leaf. |
| `kind` | string | yes | `file` or `dir`. |
| `template` | string | yes | Path template using the same `${VAR}` syntax as `paths[]`. |
| `platforms` | string[] | no | Optional platform restriction using schema-approved platform names. |
| `description` | string | no | Optional human-readable qualifier. |

### Support status and confidence enums

| Enum | Allowed values | Meaning |
|---|---|---|
| `support.*.*.status` | `supported`, `unsupported`, `unknown` | `supported` = harness exposes the surface; `unsupported` = upstream does not expose it; `unknown` = not verified yet. |
| `support.*.*.confidence` | `official`, `source`, `observed`, `inferred`, `unknown` | `official` = first-party documentation/product contract; `source` = upstream source/repo evidence; `observed` = reproduced from real installations; `inferred` = best-effort conclusion from nearby evidence; `unknown` = no confidence claim yet. |

### Unknown-data policy for support metadata

Treat unknown support data as explicit unknowns rather than partial objects or
omitted scopes/categories.

- Every harness must include `support`.
- Every support object must include every category and both scopes.
- Prefer `status: "unknown"` over guessing `supported` or `unsupported`.
- Prefer `confidence: "unknown"` over overstating certainty.
- Use empty `paths` and `sources` arrays when nothing reliable is known yet.
- Use `notes` only for concise factual qualifiers, not speculation.

Raw registry accessors, harness-list APIs, and detection results that embed a
full harness definition now expose `support` wherever they expose registry
harness entries. Dedicated support-list APIs return the support subset only.

`mise run docs:generate` regenerates both the env-var table in this document
and [support-matrix.md](./support-matrix.md). For support-only edits, you can
run `mise run docs:support-matrix:generate` directly; use `mise run docs:check`
or `mise run docs:support-matrix:check` to catch stale generated docs.

### Path spec fields (`paths[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable identifier for this path (e.g. `"config"`, `"settings"`). |
| `category` | string | yes | One of: `install`, `config`, `state`, `cache`, `project`. |
| `kind` | string | yes | `"file"` or `"dir"`. Determines whether `fs.stat` checks file or directory. |
| `template` | string | yes | Path template with `${...}` placeholders. |
| `platforms` | string[] | no | Restrict to platforms (e.g. `["darwin"]`). Omit for all platforms. |

### Root definition fields (`roots[]`)

Roots declare derived template variables that are resolved before paths. They
allow a harness to model env-var overrides cleanly.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | The template variable name to define (e.g. `CODEX_ROOT`). |
| `env` | string | no | Environment variable to check for an override (e.g. `CODEX_HOME`). |
| `use` | string | no | Template to resolve when the env var is set (can reference the env var itself). |
| `fallback` | string | yes | Template to resolve when the env var is not set. |

**Resolution order for each root:**

1. If `env` is set and the env var has a non-empty value:
   - If `use` is provided, resolve `use` against the current env + resolved
     roots + the env var itself.
   - Otherwise, use the env var value directly.
2. If the env var is not set (or `env` is omitted), resolve `fallback` against
   the current env + previously resolved roots.

Roots are resolved in declaration order, so later roots can reference earlier
ones in their `fallback` and `use` templates.

### Env var documentation fields (`env[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Environment variable name (e.g. `CODEX_HOME`). |
| `description` | string | yes | Human-readable description of what the variable does. |

> **Note:** The `env` array is **documentation only**. It does not drive
> detection behavior. Actual env-var resolution happens through `roots[]`
> entries and the base env computed by `withDefaults()`.

## Path template syntax

Templates use `${VAR_NAME}` placeholders. At resolution time:

- If a placeholder's value is undefined, null, or empty string, the **entire
  template resolves to null** in public APIs, and the path is marked as
  non-existent.
- Resolved paths are normalized (`path.normalize` in TS, `filepath.Clean` in Go).

### Built-in template variables

These are computed by `withDefaults()` in all packages and are always
available:

| Variable | Default (when env var not set) | Source |
|---|---|---|
| `${HOME}` | `os.homedir()` / `os.UserHomeDir()` | `withDefaults()` |
| `${USERPROFILE}` | Falls back to `${HOME}` | `withDefaults()` |
| `${XDG_CONFIG_HOME}` | `${HOME}/.config` | `withDefaults()` |
| `${XDG_DATA_HOME}` | `${HOME}/.local/share` | `withDefaults()` |
| `${XDG_STATE_HOME}` | `${HOME}/.local/state` | `withDefaults()` |
| `${XDG_CACHE_HOME}` | `${HOME}/.cache` | `withDefaults()` |
| `${TMPDIR}` | `os.tmpdir()` / `os.TempDir()` | `withDefaults()` |
| `${CWD}` | `process.cwd()` / `os.Getwd()` (or `options.cwd`) | `withDefaults()` |
| `${PATH}` | `process.env.PATH` / caller-supplied | Used for executable lookup |

### Harness-specific derived roots

Each harness can declare its own derived roots. For example, Codex declares:

```json
"roots": [
  {
    "name": "CODEX_ROOT",
    "env": "CODEX_HOME",
    "fallback": "${HOME}/.codex"
  }
]
```

This means:
- If `CODEX_HOME` is set, `CODEX_ROOT` = value of `CODEX_HOME`.
- Otherwise, `CODEX_ROOT` = `${HOME}/.codex`.
- Path templates can then use `${CODEX_ROOT}` (e.g.
  `${CODEX_ROOT}/config.toml`).

A more complex example (Gemini CLI) uses the `use` field:

```json
"roots": [
  {
    "name": "GEMINI_ROOT",
    "env": "GEMINI_CLI_HOME",
    "use": "${GEMINI_CLI_HOME}/.gemini",
    "fallback": "${HOME}/.gemini"
  }
]
```

This means:
- If `GEMINI_CLI_HOME` is set, `GEMINI_ROOT` = `${GEMINI_CLI_HOME}/.gemini`.
- Otherwise, `GEMINI_ROOT` = `${HOME}/.gemini`.

## Environment variables

### How env vars affect detection

Both `checkHarness()` and `detectHarnesses()` accept an optional `options`
object:

**TypeScript:**
```ts
checkHarness(input: string, options?: { env?: Record<string, string | undefined>; cwd?: string })
```

**Go:**
```go
CheckHarness(input string, options CheckOptions) (HarnessCheckResult, error)
// where CheckOptions is { Env map[string]string; CWD string }
```

When `options.env` is provided, it **replaces** `process.env` / `os.Environ()`
entirely — it does not merge. The `withDefaults()` function then fills in
missing base variables (`HOME`, `XDG_*`, `TMPDIR`, `CWD`) with defaults.

When `options.env` is omitted, the real process environment is used.

### Precedence

1. **Caller-supplied `options.env`** — if provided, this is the base environment.
2. **`withDefaults()` defaults** — fills in `HOME`, `XDG_CONFIG_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `CWD`,
   `USERPROFILE` if not already set.
3. **Harness `roots[]`** — resolved against the base env from step 2. Each
   root checks its `env` var first, then falls back.
4. **Path templates** — resolved against the fully resolved env (base + roots).

### Harness env vars by harness

The following table lists harness-specific env vars that affect path
resolution (via `roots[]`). The full `env[]` documentation array in the
registry may list additional variables that are informational only.

<!-- BEGIN: env-var-table -->

| Harness key | Override env var | Derived root | Default fallback |
|---|---|---|---|
| `amazon-q-cli` | `Q_CLI_DATA_DIR` | `Q_CLI_DATA_ROOT` | (empty — path resolves to null) |
| `amp` | — | `AMP_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/amp` |
| `amp` | `AMP_DATA_HOME` | `AMP_DATA_ROOT` | `${XDG_DATA_HOME}/amp` |
| `autogenstudio` | `AUTOGENSTUDIO_APPDIR` | `AUTOGENSTUDIO_ROOT` | `${HOME}/.autogenstudio` |
| `claude-code` | `CLAUDE_CONFIG_DIR` | `CLAUDE_ROOT` | `${HOME}/.claude` |
| `claude-code` | — | `CLAUDE_JSON_STATE` | `${HOME}/.claude.json` |
| `cline` | `CLINE_DIR` | `CLINE_ROOT` | `${HOME}/.cline` |
| `cline` | — | `CLINE_DATA_ROOT` | `${CLINE_ROOT}/data` |
| `codebuff` | — | `CODEBUFF_CONFIG_ROOT` | `${HOME}/.config/manicode` |
| `codex` | `CODEX_HOME` | `CODEX_ROOT` | `${HOME}/.codex` |
| `crush` | `CRUSH_GLOBAL_CONFIG` | `CRUSH_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/crush` |
| `crush` | — | `CRUSH_CONFIG_FILE` | `${CRUSH_CONFIG_ROOT}/crush.json` |
| `crush` | `CRUSH_GLOBAL_DATA` | `CRUSH_DATA_ROOT` | `${XDG_DATA_HOME}/crush` |
| `crush` | — | `CRUSH_DATA_FILE` | `${CRUSH_DATA_ROOT}/crush.json` |
| `crush` | `CRUSH_SKILLS_DIR` | `CRUSH_SKILLS_ROOT` | `${CRUSH_CONFIG_ROOT}/skills` |
| `droid` | — | `FACTORY_ROOT` | `${HOME}/.factory` |
| `gemini-cli` | `GEMINI_CLI_HOME` | `GEMINI_ROOT` | `${GEMINI_CLI_HOME}/.gemini` (use) or `${HOME}/.gemini` |
| `gemini-cli` | `GEMINI_CLI_TRUSTED_FOLDERS_PATH` | `GEMINI_TRUSTED_FOLDERS_FILE` | `${GEMINI_ROOT}/trustedFolders.json` |
| `github-copilot-cli` | `COPILOT_HOME` | `COPILOT_ROOT` | `${HOME}/.copilot` |
| `github-copilot-cli` | `COPILOT_CACHE_HOME` | `COPILOT_CACHE_ROOT` | (empty — path resolves to null) |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_CONFIG_ROOT` | `${GOOSE_PATH_ROOT}/config` (use) or `${XDG_CONFIG_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_DATA_ROOT` | `${GOOSE_PATH_ROOT}/data` (use) or `${XDG_DATA_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_STATE_ROOT` | `${GOOSE_PATH_ROOT}/state` (use) or `${XDG_STATE_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_HISTORY_FILE` | `${GOOSE_PATH_ROOT}/state/history.txt` (use) or `${XDG_CONFIG_HOME}/goose/history.txt` |
| `hermes-agent` | `HERMES_HOME` | `HERMES_ROOT` | `${HOME}/.hermes` |
| `mistral-vibe` | `VIBE_HOME` | `VIBE_HOME` | `${HOME}/.vibe` |
| `oh-my-pi` | `PI_CODING_AGENT_DIR` | `OMP_ROOT` | `${HOME}/.omp/agent` |
| `openclaw` | `OPENCLAW_HOME` | `OPENCLAW_ROOT` | `${HOME}/.openclaw` |
| `openclaw` | `OPENCLAW_STATE_DIR` | `OPENCLAW_STATE_ROOT` | `${OPENCLAW_ROOT}` |
| `opencode` | `OPENCODE_CONFIG_DIR` | `OPENCODE_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/opencode` |
| `opencode` | `OPENCODE_CONFIG` | `OPENCODE_CONFIG_FILE` | `${XDG_CONFIG_HOME}/opencode/opencode.json` |
| `opencode` | — | `OPENCODE_DATA_ROOT` | `${XDG_DATA_HOME}/opencode` |
| `opencode` | — | `OPENCODE_STATE_ROOT` | `${XDG_STATE_HOME}/opencode` |
| `opencode` | — | `OPENCODE_CACHE_ROOT` | `${XDG_CACHE_HOME}/opencode` |
| `trae-agent` | — | `TRAE_AGENT_ROOT` | `${HOME}/.trae-agent` |

<!-- END: env-var-table -->

Harnesses without `roots[]` entries (e.g. `aider`, `cursor`, `continue`,
`roo-code`, `boltai`, `windsurf`, `pieces`, `openhands`, and others) use
`${HOME}` or `${XDG_*}` directly in their path templates with no env override
mechanism.

## Validation behavior

### Unknown harness key

Calling `checkHarness("nonexistent")` throws (TypeScript) or returns an error
(Go):

```
Unknown harness: nonexistent
```

### Unresolved template placeholder

If a path template references a variable that is undefined, null, or empty, the
**entire path resolves to null** in public APIs, and `exists` is `false`. This
is by design — for example, `amazon-q-cli`'s `data-root-env` path resolves to
null when `Q_CLI_DATA_DIR` is not set.

### Platform-gated paths

Paths with a `platforms` array are only checked on matching platforms. On
non-matching platforms, the path entry is still returned (with `path` and
`exists` populated if the template resolves), but it is filtered out before
checking. For example, Cursor's `app-macos` path (`/Applications/Cursor.app`)
is only checked on `darwin`.

### Non-executable files

On non-Windows platforms, a file found on `PATH` must have the executable bit
set (`0o111`) to count as an executable match. A regular file without the
executable bit does not trigger detection.

On Windows, any file matching the executable name (with extensions from
`PATHEXT`) counts as a match.

## Concrete examples

### Example 1: Default detection (real environment)

```js
import { detectHarnesses } from "@auron-labs/harness-detect";

const installed = detectHarnesses().filter((r) => r.installed);
console.log(installed.map((r) => ({ key: r.key, reasons: r.reasons })));
```

### Example 2: Check a single harness with env override

```js
import { checkHarness } from "@auron-labs/harness-detect";

const result = checkHarness("codex", {
  cwd: "/my/project",
  env: {
    HOME: "/Users/test",
    CODEX_HOME: "/custom/codex",
    PATH: "/usr/local/bin:/usr/bin"
  }
});

console.log(result.installed);        // boolean
console.log(result.executablePath);   // string | null
console.log(result.matchedPaths);     // array of matched paths
console.log(result.reasons);          // e.g. ["executable:codex", "config:config"]
```

> **Privacy:** Result path values—`paths` (the resolved paths), `matchedPaths`,
> and `executablePath`—can reveal absolute usernames, home directories, project
> paths, executable paths, and harness config/state paths. Redact them before
> logs, telemetry, bug reports, screenshots, or analytics.

### Example 3: Reading the registry directly

<!-- automd:repo-stats section="data-export-example" -->

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harnesses = require("@auron-labs/harness-detect/data");

console.log(harnesses.version);
console.log(harnesses.harnesses.length);  // 51
```

<!-- /automd -->

### Example 4: Reading support metadata by scope

```js
import { getHarnessSupport } from "@auron-labs/harness-detect";

const codexSupport = getHarnessSupport("codex");

console.log(codexSupport.support.skills.global.paths);
console.log(codexSupport.support.skills.local.paths);
console.log(codexSupport.support.agents.local.status);
console.log(codexSupport.support.dotAgents.local.status);
```

Use `global` to answer user-level support questions. Use `local` to answer
workspace/project questions rooted at `${CWD}`.

## Where each setting is consumed

| Setting | Consumed in (TS) | Consumed in (Go) | Consumed in (Rust) | Consumed in (Python) |
|---|---|---|---|---|
| `options.env` | `withDefaults()` in `src/index.js` | `withDefaults()` in `harnessdetect.go` | `with_defaults()` in `src/lib.rs` | `_with_defaults()` in `__init__.py` |
| `options.cwd` | `withDefaults()` → `CWD` | `withDefaults()` → `CWD` | `with_defaults()` → `CWD` | `_with_defaults()` → `CWD` |
| `roots[]` | `resolveHarnessRoots()` in `src/index.js` | `resolveHarnessRoots()` in `harnessdetect.go` | `resolve_harness_roots()` in `src/lib.rs` | `_resolve_harness_roots()` in `__init__.py` |
| `paths[].template` | `resolveTemplate()` in `src/index.js` | `resolveTemplate()` in `harnessdetect.go` | `resolve_template()` in `src/lib.rs` | `_resolve_template()` in `__init__.py` |
| `paths[].platforms` | `platformMatches()` in `src/index.js` | `platformMatches()` in `harnessdetect.go` | `platform_matches()` in `src/lib.rs` | `_platform_matches()` in `__init__.py` |
| `executables[]` | `findExecutable()` in `src/index.js` | `findExecutable()` in `harnessdetect.go` | `find_executable()` in `src/lib.rs` | `_find_executable()` in `__init__.py` |
| `env[]` | Documentation only (not read by code) | Documentation only (not read by code) | Documentation only (not read by code) | Documentation only (not read by code) |
