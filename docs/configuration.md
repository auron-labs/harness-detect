# Configuration

harness-detect is data-driven. The primary configuration source is the **harness registry** — a JSON file that declares every known harness, its executables, path templates, environment variable overrides, support metadata, install metadata, and source URLs. There are no runtime config files, no CLI flags, and no settings files.

For a support-focused reader's view of the registry, see [support-matrix.md](./support-matrix.md). That document is generated from each harness entry's required `support` metadata in `packages/data/harnesses.json`.

## Configuration files

| File | Role | Read by |
| --- | --- | --- |
| `packages/data/harnesses.json` | Canonical shared registry (source of truth) | Tests only — all package copies must match this byte-for-byte |
| `packages/typescript/data/harnesses.json` | TypeScript package copy | `src/index.js` at import time |
| `packages/golang/harnessdetect/data/harnesses.json` | Go embedded copy | `harnessdetect.go` via `//go:embed` |
| `packages/rust/data/harnesses.json` | Rust embedded copy | `src/lib.rs` via `include_str!` |
| `packages/python/src/harness_detect/data/harnesses.json` | Python bundled copy | `__init__.py` via `importlib.resources` |

The TypeScript package also exports its registry copy as a public subpath: `@auron-labs/harness-detect/data`.

### Other config files in the repo

| File | Purpose |
| --- | --- |
| `packages/typescript/package.json` | Package metadata, scripts, exports, engines |
| `packages/typescript/tsconfig.types.json` | TypeScript type-check config (`tsc --noEmit`) |
| `packages/golang/go.mod` | Go module declaration (`go 1.26.9`, no deps) |
| `packages/rust/Cargo.toml` | Rust crate metadata (`serde` + `serde_json` deps) |
| `packages/python/pyproject.toml` | Python package metadata (stdlib-only runtime; `pytest` + `ruff` dev) |
| `mise.toml` | mise task definitions (root-level shortcuts) |
| `.github/workflows/ci.yml` | CI pipeline |

## Registry schema

A machine-checked JSON Schema (draft 2020-12) is published at `packages/data/harnesses.schema.json`. Run `mise run registry:validate` from the repo root to validate it with Ajv and check identifier collisions and duplicate path/root IDs. CI and the TypeScript suite use the same validator. The registry is a single JSON document:

```json
{
  "version": 1,
  "harnesses": [ ... ]
}
```

### Top-level fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | number | yes | Schema version. Currently `1`; keep it there unless internal tooling truly requires a document-version bump. |
| `harnesses` | array | yes | Array of harness definition objects. |

### Harness definition fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | string | yes | Stable, lowercase identifier. Part of the public API — never rename. |
| `name` | string | yes | Human-readable harness name. |
| `version` | string | yes | Upstream product version the entry's data was last verified against (for example `0.169.0`), or `unknown` when upstream publishes none. Descriptive only; refresh it whenever the entry is re-verified. |
| `aliases` | string[] | yes | Alternative lookup names (e.g. `"claude"` for `claude-code`). May be empty. |
| `executables` | string[] | yes | Executable names to search for on `PATH`. May be empty (path-only detection). |
| `paths` | object[] | yes | Path templates to check. May be empty (executable-only detection). |
| `roots` | object[] | no | Derived template variables resolved before paths. |
| `env` | object[] | yes | Documented environment variables. May be empty. |
| `sources` | string[] | yes | Evidence URLs for the path/executable rules. |
| `acp` | object | no | Local stdio ACP launch or adapter metadata; optional in stored definitions; current entries populate it explicitly. |
| `support` | object | yes | Required additive support metadata contract. Every category and both scopes must be explicit. |
| `mcp` | object | yes | MCP client metadata: MCP support, project-root `.mcp.json` support, MCP config locations per scope, and the native server shape. Never detection evidence. |
| `installations` | object[] | yes | Descriptive install metadata only; not detection evidence. |

### ACP metadata (`acp`)

ACP (Agent Client Protocol) metadata is a top-level harness field, separate from `support`, whose categories describe file locations at global/local scopes. ACP is descriptive and never counts as installation evidence. Registry version remains `1`.

The canonical registry and bundled copies contain researched ACP records, including explicit unknowns and separate adapter entries. `acp` remains optional in stored definitions. Raw/list/detection JSON surfaces preserve omission; Python's immutable typed definitions expose `acp=None`. Dedicated ACP getters normalize absent metadata to `{"status":"unknown","sources":[],"confidence":"unknown"}`.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `status` | string | yes | `supported`, `unsupported`, or `unknown`. |
| `launches` | object[] | conditional | Nonempty list of local stdio recipes: nonblank `command`, required `args` string array, optional `platforms`. |
| `installedLaunches` | object[] | no | Same shape and platform rules as `launches`, for starting the agent from a binary already on `PATH`. Requires `launches`; never a package runner (`npx`, `bunx`, `uvx`, `pnpm dlx`). An empty list means the entry is never reported as installed. |
| `adapter` | string | conditional | Exact registry key of a different entry with supported ACP and direct `launches`. |
| `sources` | string[] | yes | HTTPS evidence URLs; nonempty for `supported` and `unsupported`. |
| `confidence` | string | yes | Same values as support confidence; cannot be `unknown` for a known status. |
| `notes` | string | no | Nonempty factual qualifier. |

A `supported` entry has exactly one of `launches` or `adapter`. An `unsupported` or `unknown` entry has neither. An adapter target must use its exact registry key; aliases, self references, missing targets, adapter chains, and cycles are invalid. The referenced entry owns the launch and describes its installation requirements through its existing `installations`, `env`, and installation notes. Those requirements may include bundled components; a separate host CLI is not inherently required.

`launches[].command` is the executable name or path. Each `launches[].args` value is one argv argument, with no shell parsing or template expansion. An empty argv array and empty individual arguments are valid. Optional `launches[].platforms` is a nonempty, unique array of the registry's approved platform values; omission applies no platform restriction and is allowed only for a sole recipe. When there are multiple recipes, each must specify platforms, with no overlap between recipes. Consumers select the matching platform; the list is not an ordered fallback chain. Launches describe local stdio only. These APIs do not execute commands, install adapters, authenticate, or probe ACP at runtime.

`installedLaunches` lets an entry describe both routes: `launches` keeps the package-runner recipe, while `installedLaunches` starts the binary a user already has. Populate it only where upstream documentation or the package manifest confirms that binary serves ACP. Entries without that evidence are not returned by `detectInstalledAcpLaunches` unless their `launches` already avoid package runners. An empty `installedLaunches` list opts a launch record out of installed-launch detection entirely.

```json
{
  "status": "supported",
  "launches": [{ "command": "npx", "args": ["-y", "@example/agent", "--acp"] }],
  "installedLaunches": [{ "command": "example-agent", "args": ["--acp"] }],
  "sources": ["https://example.com/acp"],
  "confidence": "official"
}
```

Synthetic direct-launch example:

```json
{
  "status": "supported",
  "launches": [{ "command": "example-agent", "args": ["--acp"] }],
  "sources": ["https://example.com/acp"],
  "confidence": "official"
}
```

An adapter-backed entry would replace `launches` with `"adapter": "example-bridge"` and cite evidence for that relationship. Consumers read the host's ACP record, then look up `acp.adapter` once to read the owning entry's launch list.

A documented ACP launch record may omit detection signals when no portable, unambiguous signal exists, but must include setup `notes`. For example, `aider-acp` runs `node dist/index.js` from its built checkout; the caller must choose that working directory or supply the absolute script path. This entry is discoverable as metadata and never counts as installed from ACP alone: it sets `installedLaunches: []` so the `node` fallback is not reported. See [the lookup workflow](harness-guide.md#finding-and-updating-acp-records) for real examples and adapter discovery.

### MCP metadata (`mcp`)

`mcp` is required on every harness. It describes the harness as an MCP client and never affects installed status.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | enum | yes | `supported`, `unsupported`, or `unknown`: can the harness use MCP servers at all. |
| `mcpJson` | enum | yes | Does the harness read the project-root `${CWD}/.mcp.json` (`{"mcpServers": {...}}`) **by default**. Opt-in or plugin-only reading is `unsupported` with a note. |
| `global` | object | yes | User-level MCP config scope (see below). |
| `local` | object | yes | Project-level MCP config scope: the harness's native project file, anchored at `${CWD}`. |
| `serverFormat` | object | no | Native shape of one server entry; required when a scope has a `format`. Used by `translateMcpJson`. |
| `sources` | string[] | yes | Evidence URLs; at least one unless `status` is `unknown`. |
| `confidence` | enum | yes | Same enum as support leaves; not `unknown` unless `status` is `unknown`. |
| `notes` | string | no | Short factual qualifier (opt-ins, UI-only management, unsupported transports). |

Scope objects (`global`, `local`) mirror support leaves plus two fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `status`, `paths`, `sources`, `confidence`, `notes` |  |  | Same meaning and rules as support leaves. `paths` lists the config files (or directories of config files) holding MCP servers. Global templates must not start with `${CWD}`; local templates must. |
| `format` | enum | when supported with paths | `json`, `jsonc`, `toml`, or `yaml`. Forbidden otherwise. |
| `keyPath` | string[] | when supported with paths | Key segments the servers live under, outermost first: `["mcpServers"]`, `["mcp_servers"]`, `["mcp", "servers"]`. A literal key containing a dot is one segment (`["amp.mcpServers"]`). |

All paths in one scope share `format` and `keyPath`; a harness whose MCP servers are managed only through a UI or database is `supported` with empty `paths`.

`serverFormat` maps `.mcp.json` fields to native field names:

| Field | Description |
| --- | --- |
| `container` | `map` (object keyed by server name) or `array` (list of entries; requires `nameField`). |
| `nameField` | Field that stores the server name inside each entry; optional for maps. |
| `typeField` | Field that names the transport. Required when any transport sets `type`. |
| `stdio` | `{type?, command, commandFormat?, args?, env?}`. With `commandFormat: "shlex"`, the command field holds a quoted string containing the executable and all arguments; any mapped `args` field is an empty list. Without either field, the command holds an argv array `[command, ...args]`. |
| `http`, `sse` | `{type?, url, headers?}`. Omit a transport the harness cannot use. |
| `defaults` | Static scalar fields written into every entry before mapped fields (for example `{"enabled": true}`). |

Omitting `env` or `headers` means servers that set them are skipped rather than translated without them. Example (Gemini CLI, which selects transports by field name instead of a type field):

```json
"serverFormat": {
  "container": "map",
  "stdio": { "command": "command", "args": "args", "env": "env" },
  "http": { "url": "httpUrl", "headers": "headers" },
  "sse": { "url": "url", "headers": "headers" }
}
```

### Support metadata fields (`support`)

`support` is additive public registry metadata. It does **not** affect installed status. It documents whether a harness supports specific features at two scopes. Because the project is still pre-publication, this field was added by aligning the clean public shape directly instead of adding compatibility layers.

- `global`: user-level or machine-level support outside a specific workspace.
- `local`: project/workspace-local support rooted at `${CWD}`. In user-facing docs, describe this scope as **local/project**.

That `local` meaning is shared across `config`, `skills`, `commands`, `agents`, and `agentsSkills`: if a harness stores those surfaces inside a repo or workspace, model them under `support.<category>.local` and anchor the paths to `${CWD}` when the upstream layout is project-relative.

Every harness must include `support`, and it must include all categories and both scopes explicitly. Do not omit a leaf because the data is missing — encode the uncertainty with `status: "unknown"`, `confidence: "unknown"`, and empty `paths` / `sources` arrays.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `config` | object | yes | Support status for config files/directories. |
| `skills` | object | yes | Support status for skills/prompts directories or files. |
| `commands` | object | yes | Support status for slash commands, command packs, or equivalent command files. |
| `agents` | object | yes | Support status for agent definitions or agent manifests. |
| `agentsSkills` | object | yes | Whether the harness discovers Agent Skills from the shared `.agents/skills` directory by default (`${HOME}/.agents/skills` globally, `${CWD}/.agents/skills` locally). Global paths may use a derived home root for an override. Opt-in discovery is `unsupported` with a note; vendor directories such as `.claude/skills` belong under `skills`. |

Each category object must contain both scopes:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `global` | object | yes | Global/user-level support leaf. |
| `local` | object | yes | Local/project-scoped support leaf rooted at `${CWD}`. |

Each support leaf must use this shape:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | yes | One of `supported`, `unsupported`, `unknown`. |
| `paths` | object[] | yes | Path definitions for the support surface. Use an empty array when none are known or applicable. |
| `sources` | string[] | yes | Evidence URLs supporting this leaf. Use an empty array only when the leaf is `unknown` or there is no direct source for an `observed`/`inferred` entry. |
| `confidence` | string | yes | One of `official`, `source`, `observed`, `inferred`, `unknown`. |
| `notes` | string | no | Short factual qualifier. |

Support path entries intentionally reuse the main registry path vocabulary where possible:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable path identifier within the leaf. |
| `kind` | string | yes | `file` or `dir`. |
| `template` | string | yes | Path template using the same `${VAR}` syntax as `paths[]`. |
| `platforms` | string[] | no | Optional platform restriction using schema-approved platform names. |
| `description` | string | no | Optional human-readable qualifier. |

### Support status and confidence enums

| Enum | Allowed values | Meaning |
| --- | --- | --- |
| `support.*.*.status` | `supported`, `unsupported`, `unknown` | `supported` = harness exposes the surface; `unsupported` = upstream does not expose it; `unknown` = not verified yet. |
| `support.*.*.confidence` | `official`, `source`, `observed`, `inferred`, `unknown` | `official` = first-party documentation/product contract; `source` = upstream source/repo evidence; `observed` = reproduced from real installations; `inferred` = best-effort conclusion from nearby evidence; `unknown` = no confidence claim yet. |

### Unknown-data policy for support metadata

Treat unknown support data as explicit unknowns rather than partial objects or omitted scopes/categories.

- Every harness must include `support`.
- Every support object must include every category and both scopes.
- Prefer `status: "unknown"` over guessing `supported` or `unsupported`.
- Prefer `confidence: "unknown"` over overstating certainty.
- Use empty `paths` and `sources` arrays when nothing reliable is known yet.
- Use `notes` only for concise factual qualifiers, not speculation.

Raw registry accessors, harness-list APIs, and detection results that embed a full harness definition now expose `support` wherever they expose registry harness entries. Dedicated support-list APIs return the support subset only.

`mise run docs:generate` regenerates both the env-var table in this document and [support-matrix.md](./support-matrix.md). For support-only edits, you can run `mise run docs:support-matrix:generate` directly; use `mise run docs:check` or `mise run docs:support-matrix:check` to catch stale generated docs.

### Path spec fields (`paths[]`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable identifier for this path (e.g. `"config"`, `"settings"`). |
| `category` | string | yes | One of: `install`, `config`, `state`, `cache`, `project`. |
| `kind` | string | yes | `"file"` or `"dir"`. Determines whether `fs.stat` checks file or directory. |
| `template` | string | yes | Path template with `${...}` placeholders. |
| `platforms` | string[] | no | Restrict to platforms (e.g. `["darwin"]`). Omit for all platforms. |

### Root definition fields (`roots[]`)

Roots declare derived template variables that are resolved before paths. They allow a harness to model env-var overrides cleanly.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | The template variable name to define (e.g. `CODEX_ROOT`). |
| `env` | string | no | Environment variable to check for an override (e.g. `CODEX_HOME`). |
| `use` | string | no | Template to resolve when the env var is set (can reference the env var itself). |
| `fallbackEnv` | string | no | Secondary environment variable to use when `env` is unset or empty. |
| `fallback` | string | yes | Template to resolve when neither override is set. |

**Resolution order for each root:**

1. If `env` is set and the env var has a non-empty value:
   - If `use` is provided, resolve `use` against the current env + resolved roots + the env var itself.
   - Otherwise, use the env var value directly.
2. If `env` is unset or empty and `fallbackEnv` is set and non-empty, use that secondary env-var value.
3. Otherwise, resolve `fallback` against the current env + previously resolved roots.

Roots are resolved in declaration order, so later roots can reference earlier ones in their `fallback` and `use` templates.

### Env var documentation fields (`env[]`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Environment variable name (e.g. `CODEX_HOME`). |
| `description` | string | yes | Human-readable description of what the variable does. |

> **Note:** The `env` array is **documentation only**. It does not drive detection behavior. Actual env-var resolution happens through `roots[]` entries and the base env computed by `withDefaults()`.

## Path template syntax

Templates use `${VAR_NAME}` placeholders. At resolution time:

- If a placeholder's value is undefined, null, or empty string, the **entire template resolves to null** in public APIs, and the path is marked as non-existent.
- Resolved paths are normalized (`path.normalize` in TS, `filepath.Clean` in Go).

### Built-in template variables

These are computed by `withDefaults()` in all packages and are always available:

| Variable | Default (when env var not set) | Source |
| --- | --- | --- |
| `${HOME}` | On Windows, `USERPROFILE` (case-insensitive) if set; otherwise the process user's home directory | `withDefaults()` |
| `${USERPROFILE}` | Falls back to `${HOME}` | `withDefaults()` |
| `${XDG_CONFIG_HOME}` | `${HOME}/.config` | `withDefaults()` |
| `${XDG_DATA_HOME}` | `${HOME}/.local/share` | `withDefaults()` |
| `${XDG_STATE_HOME}` | `${HOME}/.local/state` | `withDefaults()` |
| `${XDG_CACHE_HOME}` | `${HOME}/.cache` | `withDefaults()` |
| `${TMPDIR}` | `os.tmpdir()` / `os.TempDir()` | `withDefaults()` |
| `${CWD}` | `process.cwd()` / `os.Getwd()` (or `options.cwd`) | `withDefaults()` |
| `${PATH}` | `process.env.PATH` / caller-supplied | Used for executable lookup |

**Stakpak and OpenFang on Windows:** Detection uses `USERPROFILE` for the default config paths. If it is unset or empty, the registry falls back to normalized `HOME`, which may not be the Windows profile these harnesses use. Changing `USERPROFILE` also does not move the Windows Known Folder used by Stakpak Autopilot and OpenFang.

**Agent Swarm:** Use an absolute `AGENT_SWARM_DIR` for a relocated one-shot install. Relative paths depend on the installer's working directory, and the installer does not expand a literal leading tilde. Detection uses normalized `HOME` for the default directory, even if the installer had no usable `HOME`.

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
- Path templates can then use `${CODEX_ROOT}` (e.g. `${CODEX_ROOT}/config.toml`).

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

Both `checkHarness()` and `detectHarnesses()` accept an optional `options` object:

**TypeScript:**

```ts
checkHarness(input: string, options?: { env?: Record<string, string | undefined>; cwd?: string })
```

**Go:**

```go
CheckHarness(input string, options CheckOptions) (HarnessCheckResult, error)
// where CheckOptions is { Env map[string]string; CWD string }
```

When `options.env` is provided, it **replaces** `process.env` / `os.Environ()` entirely — it does not merge. The `withDefaults()` function then fills in missing base variables (`HOME`, `XDG_*`, `TMPDIR`, `CWD`) with defaults.

When `options.env` is omitted, the real process environment is used.

### Precedence

1. **Caller-supplied `options.env`** — if provided, this is the base environment.
2. **`withDefaults()` defaults** — fills in `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `CWD`, `USERPROFILE` if not already set.
3. **Harness `roots[]`** — resolved against the base env from step 2. Each root checks its `env` var first, then falls back.
4. **Path templates** — resolved against the fully resolved env (base + roots).

### Harness env vars by harness

The following table lists harness-specific env vars that affect path resolution (via `roots[]`). The full `env[]` documentation array in the registry may list additional variables that are informational only.

<!-- prettier-ignore-start -->

<!-- BEGIN: env-var-table -->

| Harness key | Override env var | Derived root | Default fallback |
|---|---|---|---|
| `agent-swarm` | `AGENT_SWARM_DIR` | `AGENT_SWARM_INSTALL_ROOT` | `${HOME}/agent-swarm` |
| `aiwg` | `AIWG_PROJECT_AIWG_DIR` | `AIWG_LEGACY_ARTIFACT_ROOT` | (empty — path resolves to null) |
| `aiwg` | `AIWG_ARTIFACTS_PATH` | `AIWG_EXPLICIT_ARTIFACT_ROOT` | `${AIWG_LEGACY_ARTIFACT_ROOT}` |
| `aiwg` | `AIWG_CONFIG` | `AIWG_EXPLICIT_USER_CONFIG` | (empty — path resolves to null) |
| `amazon-q-cli` | `Q_CLI_DATA_DIR` | `Q_CLI_DATA_ROOT` | (empty — path resolves to null) |
| `amp` | — | `AMP_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/amp` |
| `amp` | `AMP_DATA_HOME` | `AMP_DATA_ROOT` | `${XDG_DATA_HOME}/amp` |
| `astrbot` | `ASTRBOT_ROOT` | `ASTRBOT_RUNTIME_ROOT` | `${CWD}` |
| `atlas` | `APPDATA` | `ATLAS_ROAMING_DATA` | `${USERPROFILE}/AppData/Roaming` |
| `autogenstudio` | `AUTOGENSTUDIO_APPDIR` | `AUTOGENSTUDIO_ROOT` | `${HOME}/.autogenstudio` |
| `bossconsole` | `USERPROFILE` | `BOSSCONSOLE_WINDOWS_PROFILE` | `${HOME}` |
| `browser-use` | `BROWSER_USE_CONFIG_DIR` | `BROWSER_USE_PROFILE_ROOT` | `${XDG_CONFIG_HOME}/browseruse` |
| `browser-use` | `BROWSER_USE_CONFIG_PATH` | `BROWSER_USE_LEGACY_CONFIG` | `${BROWSER_USE_PROFILE_ROOT}/config.json` |
| `cc-haha` | `CLAUDE_CONFIG_DIR` | `CC_HAHA_ROOT` | `${HOME}/.claude` |
| `cc-haha` | `CLAUDE_CONFIG_DIR` | `CC_HAHA_WINDOWS_ROOT` | `${USERPROFILE}/.claude` |
| `cc-haha` | `LOCALAPPDATA` | `CC_HAHA_LOCAL_APPDATA` | `${USERPROFILE}/AppData/Local` |
| `claude-code` | `CLAUDE_CONFIG_DIR` | `CLAUDE_ROOT` | `${HOME}/.claude` |
| `claude-code` | — | `CLAUDE_JSON_STATE` | `${HOME}/.claude.json` |
| `cline` | `CLINE_DIR` | `CLINE_ROOT` | `${HOME}/.cline` |
| `cline` | `CLINE_DATA_DIR` | `CLINE_DATA_ROOT` | `${CLINE_ROOT}/data` |
| `codebuff` | — | `CODEBUFF_CONFIG_ROOT` | `${HOME}/.config/manicode` |
| `codex` | `CODEX_HOME` | `CODEX_ROOT` | `${HOME}/.codex` |
| `cowagent` | `COW_DATA_DIR` | `COWAGENT_SOURCE_DATA` | `${CWD}` |
| `crush` | `CRUSH_GLOBAL_CONFIG` | `CRUSH_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/crush` |
| `crush` | — | `CRUSH_CONFIG_FILE` | `${CRUSH_CONFIG_ROOT}/crush.json` |
| `crush` | `CRUSH_GLOBAL_DATA` | `CRUSH_DATA_ROOT` | `${XDG_DATA_HOME}/crush` |
| `crush` | — | `CRUSH_DATA_FILE` | `${CRUSH_DATA_ROOT}/crush.json` |
| `crush` | `CRUSH_SKILLS_DIR` | `CRUSH_SKILLS_ROOT` | `${CRUSH_CONFIG_ROOT}/skills` |
| `deepagents-code` | `DEEPAGENTS_HOME` | `DEEPAGENTS_ROOT` | `${HOME}/.deepagents` |
| `deepseek-harness` | `DSH_HOME` | `DSH_ROOT` | `${HOME}/.dsh` |
| `deerflow` | `DEER_FLOW_PROJECT_ROOT` | `DEERFLOW_PROJECT_ROOT` | `${CWD}` |
| `deerflow` | `DEER_FLOW_HOME` | `DEERFLOW_RUNTIME_ROOT` | `${DEERFLOW_PROJECT_ROOT}/.deer-flow` |
| `deerflow` | `DEER_FLOW_CONFIG_PATH` | `DEERFLOW_CONFIG_FILE` | `${DEERFLOW_PROJECT_ROOT}/config.yaml` |
| `deerflow` | `DEER_FLOW_SKILLS_PATH` | `DEERFLOW_SKILLS_ROOT` | `${DEERFLOW_PROJECT_ROOT}/skills` |
| `droid` | — | `FACTORY_ROOT` | `${HOME}/.factory` |
| `eigent` | `EIGENT_RUN_JOURNAL_PATH` | `EIGENT_JOURNAL_FILE` | `${HOME}/.eigent/run-journal.sqlite3` |
| `ekko-studio` | `HERMES_WEB_UI_HOME` | `EKKO_STUDIO_HOME` | `${HOME}/.hermes-web-ui` |
| `ekko-studio` | `HERMES_WEB_UI_HOME` | `EKKO_STUDIO_WINDOWS_HOME` | `${USERPROFILE}/.hermes-web-ui` |
| `emdash` | `EMDASH_USER_DATA_DIR` | `EMDASH_PROFILE_LINUX` | `${XDG_CONFIG_HOME}/emdash` |
| `emdash` | `EMDASH_USER_DATA_DIR` | `EMDASH_PROFILE_DARWIN` | `${HOME}/Library/Application Support/emdash` |
| `emdash` | `EMDASH_USER_DATA_DIR` | `EMDASH_PROFILE_WIN32` | `${APPDATA}/emdash` |
| `empryo` | `LOCALAPPDATA` | `EMPRYO_WIN_LOCAL_APPDATA` | (empty — path resolves to null) |
| `fast-agent` | `FAST_AGENT_HOME` | `FAST_AGENT_ROOT` | `${CWD}/.fast-agent` |
| `fast-agent` | `FAST_AGENT_HOME` | `FAST_AGENT_GLOBAL_PLUGIN_ROOT` | `${HOME}/.fast-agent` |
| `fivedive` | `STATE_DIR` | `FIVEDIVE_STATE_ROOT` | `/var/lib/5dive` |
| `flowise` | `DATABASE_PATH` | `FLOWISE_SQLITE_DIR` | `${HOME}/.flowise` |
| `flowise` | `DATABASE_PATH` | `FLOWISE_WINDOWS_SQLITE_DIR` | `${USERPROFILE}/.flowise` |
| `gemini-cli` | `GEMINI_CLI_HOME` | `GEMINI_ROOT` | `${GEMINI_CLI_HOME}/.gemini` (use) or `${HOME}/.gemini` |
| `gemini-cli` | `GEMINI_CLI_TRUSTED_FOLDERS_PATH` | `GEMINI_TRUSTED_FOLDERS_FILE` | `${GEMINI_ROOT}/trustedFolders.json` |
| `gentle-shell` | `GENTLE_SHELL_HOME` | `GENTLE_SHELL_ROOT` | `${HOME}/.gentle-shell/agent` |
| `gentle-shell` | `GENTLE_SHELL_HOME` | `GENTLE_SHELL_WIN_ROOT` | `${USERPROFILE}/.gentle-shell/agent` |
| `github-copilot-cli` | `COPILOT_HOME` | `COPILOT_ROOT` | `${HOME}/.copilot` |
| `github-copilot-cli` | `COPILOT_CACHE_HOME` | `COPILOT_CACHE_ROOT` | (empty — path resolves to null) |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_CONFIG_ROOT` | `${GOOSE_PATH_ROOT}/config` (use) or `${XDG_CONFIG_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_DATA_ROOT` | `${GOOSE_PATH_ROOT}/data` (use) or `${XDG_DATA_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_STATE_ROOT` | `${GOOSE_PATH_ROOT}/state` (use) or `${XDG_STATE_HOME}/goose` |
| `goose` | `GOOSE_PATH_ROOT` | `GOOSE_HISTORY_FILE` | `${GOOSE_PATH_ROOT}/state/history.txt` (use) or `${XDG_STATE_HOME}/goose/history.txt` |
| `graphcode` | `GRAPHCODE_SUPPORT_DIR` | `GRAPHCODE_ROOT` | `${HOME}/.graphcode` |
| `grok-build-cli` | `GROK_HOME` | `GROK_ROOT` | `${HOME}/.grok` |
| `happy-cli` | `HAPPY_HOME_DIR` | `HAPPY_ROOT` | `${HOME}/.happy` |
| `herdr` | `APPDATA` | `HERDR_WINDOWS_CONFIG` | `${APPDATA}/herdr` (use) or `${USERPROFILE}/AppData/Roaming/herdr` |
| `hermes-agent` | `HERMES_HOME` | `HERMES_ROOT` | `${HOME}/.hermes` |
| `jcode` | `JCODE_HOME` | `JCODE_ROOT` | `${HOME}/.jcode` |
| `jcode` | `JCODE_HOME` | `JCODE_EXTERNAL_HOME` | `${JCODE_ROOT}/external` (use) or `${HOME}` |
| `lime` | `XDG_CONFIG_HOME` | `LIME_LINUX_CONFIG_BASE` | `${HOME}/.config` |
| `lime` | `XDG_DATA_HOME` | `LIME_LINUX_DATA_BASE` | `${HOME}/.local/share` |
| `lime` | `USERPROFILE` | `LIME_WINDOWS_PROFILE` | `${HOME}` |
| `lime` | `APPDATA` | `LIME_WINDOWS_CONFIG_BASE` | `${LIME_WINDOWS_PROFILE}/AppData/Roaming` |
| `lime` | `LOCALAPPDATA` | `LIME_WINDOWS_DATA_BASE` | `${LIME_WINDOWS_PROFILE}/AppData/Local` |
| `lime` | `LIME_CONFIG_PATH` | `LIME_LINUX_CONFIG` | `${LIME_LINUX_CONFIG_BASE}/lime/config.yaml` |
| `lime` | `LIME_CONFIG_PATH` | `LIME_MAC_CONFIG` | `${HOME}/Library/Application Support/lime/config.yaml` |
| `lime` | `LIME_CONFIG_PATH` | `LIME_WINDOWS_CONFIG` | `${LIME_WINDOWS_CONFIG_BASE}/lime/config.yaml` |
| `lime` | `LIME_AGENT_RUNTIME_ROOT` | `LIME_LINUX_RUNTIME` | `${LIME_LINUX_DATA_BASE}/lime/app-server` |
| `lime` | `LIME_AGENT_RUNTIME_ROOT` | `LIME_MAC_RUNTIME` | `${HOME}/Library/Application Support/lime/app-server` |
| `lime` | `LIME_AGENT_RUNTIME_ROOT` | `LIME_WINDOWS_RUNTIME` | `${LIME_WINDOWS_DATA_BASE}/LimeCloud/lime/app-server` |
| `lime` | `NPM_CONFIG_PREFIX` | `LIME_NPM_PREFIX` | (empty — path resolves to null) |
| `lime` | `npm_config_prefix` | `LIME_NPM_LOWERCASE_PREFIX` | (empty — path resolves to null) |
| `lime` | `NPM_CONFIG_PREFIX` | `LIME_WINDOWS_NPM_PREFIX` | (empty — path resolves to null) |
| `metagpt` | `METAGPT_PROJECT_ROOT` | `METAGPT_ROOT` | `${CWD}` |
| `mini-swe-agent` | `MSWEA_GLOBAL_CONFIG_DIR` | `MINI_SWE_LINUX_ROOT` | `${XDG_CONFIG_HOME}/mini-swe-agent` |
| `mini-swe-agent` | `MSWEA_GLOBAL_CONFIG_DIR` | `MINI_SWE_MACOS_ROOT` | `${HOME}/Library/Application Support/mini-swe-agent` |
| `mini-swe-agent` | `MSWEA_GLOBAL_CONFIG_DIR` | `MINI_SWE_WINDOWS_ROOT` | `${LOCALAPPDATA}/mini-swe-agent/mini-swe-agent` |
| `mirix` | `MEMGPT_CONFIG_PATH` | `MIRIX_CONFIG_FILE` | `${HOME}/.mirix/config` |
| `mirix` | `MEMGPT_CONFIG_PATH` | `MIRIX_WINDOWS_CONFIG_FILE` | `${USERPROFILE}/.mirix/config` |
| `mistral-vibe` | `VIBE_HOME` | `VIBE_HOME` | `${HOME}/.vibe` |
| `n8n` | `N8N_USER_FOLDER` | `N8N_STATE_PARENT` | `${HOME}` |
| `n8n` | `N8N_USER_FOLDER` | `N8N_WINDOWS_STATE_PARENT` | `${USERPROFILE}` |
| `nac` | `NAC_HOME` | `NAC_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/nac` |
| `oh-my-pi` | `PI_CODING_AGENT_DIR` | `OMP_ROOT` | `${HOME}/.omp/agent` |
| `omnigent` | `OMNIGENT_CONFIG_HOME` | `OMNIGENT_CONFIG_ROOT` | `${HOME}/.omnigent` |
| `omnigent` | `OMNIGENT_DATA_DIR` | `OMNIGENT_DATA_ROOT` | `${HOME}/.omnigent` |
| `open-design` | `OD_DATA_DIR` | `OPEN_DESIGN_SOURCE_DATA` | `${CWD}/.od` |
| `open-design` | `APPDATA` | `OPEN_DESIGN_APPDATA` | `${USERPROFILE}/AppData/Roaming` |
| `openagents-coder` | `OPENAGENTS_HOME` | `OPENAGENTS_INSTALL_HOME` | `${HOME}/.openagents` |
| `openagents-coder` | `USERPROFILE` | `OPENAGENTS_WINDOWS_USER_HOME` | `${HOME}` |
| `openagents-coder` | `OPENAGENTS_HOME` | `OPENAGENTS_WINDOWS_INSTALL_HOME` | `${OPENAGENTS_WINDOWS_USER_HOME}/.openagents` |
| `openagents-coder` | `CODER_BIN_DIR` | `OPENAGENTS_CODER_BIN` | `${OPENAGENTS_INSTALL_HOME}/bin` |
| `openagents-coder` | `CODER_BIN_DIR` | `OPENAGENTS_CODER_WINDOWS_BIN` | `${OPENAGENTS_WINDOWS_INSTALL_HOME}/bin` |
| `openagents-coder` | `CODER_HOME` | `OPENAGENTS_CODER_STATE_HOME` | `${HOME}` |
| `openamer` | `OPENAMER_HOME` | `OPENAMER_ROOT` | `${HOME}/.openamer` |
| `openamer` | `LOCALAPPDATA` | `OPENAMER_WINDOWS_LOCAL_DATA` | `${USERPROFILE}/AppData/Local` |
| `openamer` | `OPENAMER_HOME` | `OPENAMER_WINDOWS_ROOT` | `${OPENAMER_WINDOWS_LOCAL_DATA}/openamer` |
| `openclaw` | `OPENCLAW_HOME` | `OPENCLAW_ROOT` | `${HOME}/.openclaw` |
| `openclaw` | `OPENCLAW_STATE_DIR` | `OPENCLAW_STATE_ROOT` | `${OPENCLAW_ROOT}` |
| `opencode` | `OPENCODE_CONFIG_DIR` | `OPENCODE_CONFIG_ROOT` | `${XDG_CONFIG_HOME}/opencode` |
| `opencode` | `OPENCODE_CONFIG` | `OPENCODE_CONFIG_FILE` | `${XDG_CONFIG_HOME}/opencode/opencode.json` |
| `opencode` | — | `OPENCODE_DATA_ROOT` | `${XDG_DATA_HOME}/opencode` |
| `opencode` | — | `OPENCODE_STATE_ROOT` | `${XDG_STATE_HOME}/opencode` |
| `opencode` | — | `OPENCODE_CACHE_ROOT` | `${XDG_CACHE_HOME}/opencode` |
| `opencompany` | `OPENCOMPANY_DATA_DIR` | `OPENCOMPANY_DATA_ROOT` | `${HOME}/.opencompany` |
| `openfang` | `OPENFANG_HOME` | `OPENFANG_ROOT` | `${HOME}/.openfang` |
| `openfang` | `OPENFANG_HOME` | `OPENFANG_WINDOWS_ROOT` | `${USERPROFILE}/.openfang` |
| `openfang` | `OPENFANG_INSTALL_DIR` | `OPENFANG_INSTALL_ROOT` | `${HOME}/.openfang/bin` |
| `openfang` | `OPENFANG_INSTALL_DIR` | `OPENFANG_WINDOWS_INSTALL_ROOT` | `${USERPROFILE}/.openfang/bin` |
| `openharness` | `OPENHARNESS_CONFIG_DIR` | `OPENHARNESS_CONFIG_ROOT` | `${HOME}/.openharness` |
| `openharness` | `OPENHARNESS_DATA_DIR` | `OPENHARNESS_DATA_ROOT` | `${OPENHARNESS_CONFIG_ROOT}/data` |
| `openharness` | `OPENHARNESS_LOGS_DIR` | `OPENHARNESS_LOGS_ROOT` | `${OPENHARNESS_CONFIG_ROOT}/logs` |
| `openharness` | `OHMO_WORKSPACE` | `OHMO_WORKSPACE_ROOT` | `${HOME}/.ohmo` |
| `openhuman` | `OPENHUMAN_HOME` | `OPENHUMAN_AGENT_DEFINITIONS_ROOT` | `${HOME}/.openhuman` |
| `openhuman` | `ProgramFiles` | `OPENHUMAN_PROGRAM_FILES` | (empty — path resolves to null) |
| `openjarvis` | `OPENJARVIS_HOME` | `OPENJARVIS_ROOT` | `${HOME}/.openjarvis` |
| `openjarvis` | `OPENJARVIS_HOME` | `OPENJARVIS_WINDOWS_CONFIG_ROOT` | `${USERPROFILE}/.openjarvis` |
| `openjarvis` | `OPENJARVIS_HOME` | `OPENJARVIS_WINDOWS_INSTALL_ROOT` | `${LOCALAPPDATA}/OpenJarvis` |
| `openrig` | `OPENRIG_HOME` | `OPENRIG_ROOT` | `${HOME}/.openrig` |
| `openrig` | `OPENRIG_SKILLS_ROOT` | `OPENRIG_SKILLS` | `${OPENRIG_ROOT}/skills` |
| `orbi` | `ORBI_CONFIG` | `ORBI_CONFIG_FILE` | `${CWD}/orbi.toml` |
| `orbi` | `ORBI_UNIT_DIR` | `ORBI_SYSTEMD_UNIT_DIR` | `${XDG_CONFIG_HOME}/systemd/user` |
| `orbi` | `ORBI_UNIT_DIR` | `ORBI_LAUNCHD_UNIT_DIR` | `${HOME}/Library/LaunchAgents` |
| `orkas` | `ORKAS_WORKSPACE_ROOT` | `ORKAS_UNIX_DATA` | `${HOME}/.orkas/data` |
| `orkas` | `ORKAS_WORKSPACE_ROOT` | `ORKAS_WIN_DATA` | (empty — path resolves to null) |
| `orkas` | `LOCALAPPDATA` | `ORKAS_WIN_LOCAL_APPDATA` | `${USERPROFILE}/AppData/Local` |
| `paradev` | `SUPERSET_HOME_DIR` | `PARADEV_ROOT` | `${HOME}/.paradev` |
| `paradev` | `SUPERSET_HOME` | `PARADEV_CLI_INSTALL_ROOT` | `${HOME}/superset` |
| `pipali` | `APPDATA` | `PIPALI_ROAMING` | `${USERPROFILE}/AppData/Roaming` |
| `pipali` | `PIPALI_SKILLS_DIR` | `PIPALI_SKILLS_ROOT` | `${HOME}/.pipali/skills` |
| `prime-agent` | `PRIME_AGENT_CODING_AGENT_DIR` | `PRIME_AGENT_ROOT` | `${HOME}/.prime/agent` |
| `prime-agent` | `PRIME_AGENT_SESSION_DIR` | `PRIME_AGENT_SESSION_ROOT` | `${PRIME_AGENT_ROOT}/sessions` |
| `qwenpaw` | `QWENPAW_WORKING_DIR` | `QWENPAW_ROOT` | `${HOME}/.qwenpaw` |
| `qwenpaw` | `ProgramFiles` | `QWENPAW_PROGRAM_FILES` | (empty — path resolves to null) |
| `raven` | `RAVEN_HOME` | `RAVEN_ROOT` | `${HOME}/.raven` |
| `raven` | `RAVEN_HOME` | `RAVEN_WIN_ROOT` | `${USERPROFILE}/.raven` |
| `reasonix` | `APPDATA` | `REASONIX_ROAMING` | `${USERPROFILE}/AppData/Roaming` |
| `reasonix` | `REASONIX_HOME` | `REASONIX_UNIX_HOME` | `${HOME}/.reasonix` |
| `reasonix` | `REASONIX_HOME` | `REASONIX_WIN_HOME` | `${REASONIX_ROAMING}/reasonix` |
| `reef` | `REEF_NATIVE_DIR` | `REEF_NATIVE_ROOT` | `${CWD}/native` |
| `sourcegraph-cody` | `APPDATA` | `CODY_WIN_ROAMING` | `${USERPROFILE}/AppData/Roaming` |
| `tale` | `LOCALAPPDATA` | `TALE_WIN_LOCAL_APP_DATA` | (empty — path resolves to null) |
| `tale` | `TALE_SANDBOX_HOME` | `TALE_SANDBOX_ROOT` | `${HOME}/.tale/sandbox` |
| `talon` | `TALON_HOME` | `TALON_ROOT` | `${HOME}/.talon` |
| `talon` | `USERPROFILE` | `TALON_WINDOWS_PROFILE` | `${HOME}` |
| `talon` | `TALON_HOME` | `TALON_WINDOWS_ROOT` | `${TALON_WINDOWS_PROFILE}/.talon` |
| `talon` | `NPM_CONFIG_PREFIX` | `TALON_NPM_PREFIX` | (empty — path resolves to null) |
| `talon` | `npm_config_prefix` | `TALON_NPM_LOWERCASE_PREFIX` | (empty — path resolves to null) |
| `talon` | `APPDATA` | `TALON_WINDOWS_APPDATA` | `${TALON_WINDOWS_PROFILE}/AppData/Roaming` |
| `talon` | `NPM_CONFIG_PREFIX` | `TALON_WINDOWS_NPM_PREFIX` | (empty — path resolves to null) |
| `tianshu` | `LOCALAPPDATA` | `TIANSHU_LOCAL_DATA` | `${USERPROFILE}/AppData/Local` |
| `tianshu` | `APPDATA` | `TIANSHU_ROAMING_DATA` | `${USERPROFILE}/AppData/Roaming` |
| `tianshu` | `RIVET_HOME` | `TIANSHU_DATA_ROOT` | `${HOME}/.rivet` |
| `tianshu` | `RIVET_HOME` | `TIANSHU_WINDOWS_ROOT` | `${TIANSHU_LOCAL_DATA}/.rivet` |
| `tianshu` | `RIVET_CONFIG_PATH` | `TIANSHU_EXPLICIT_CONFIG` | (empty — path resolves to null) |
| `trae-agent` | — | `TRAE_AGENT_ROOT` | `${HOME}/.trae-agent` |
| `tuios` | `LOCALAPPDATA` | `TUIOS_WINDOWS_CONFIG_BASE` | `${USERPROFILE}/AppData/Local` |
| `vtcode` | `VTCODE_CONFIG` | `VTCODE_CONFIG_XDG` | `${XDG_CONFIG_HOME}/vtcode` |
| `vtcode` | `VTCODE_CONFIG` | `VTCODE_CONFIG_MACOS` | `${HOME}/Library/Application Support/com.vinhnx.vtcode` |
| `vtcode` | `VTCODE_CONFIG` | `VTCODE_CONFIG_WINDOWS` | `${APPDATA}/vinhnx/vtcode/config` |
| `vtcode` | `VTCODE_DATA` | `VTCODE_DATA_XDG` | `${XDG_DATA_HOME}/vtcode` |
| `vtcode` | `VTCODE_DATA` | `VTCODE_DATA_MACOS` | `${HOME}/Library/Application Support/com.vinhnx.vtcode` |
| `vtcode` | `VTCODE_DATA` | `VTCODE_DATA_WINDOWS` | `${APPDATA}/vinhnx/vtcode/data` |
| `vtcode` | `VTCODE_HOME` | `VTCODE_LEGACY_ROOT` | `${HOME}/.vtcode` |
| `workkit` | `WORKFLOW_HOME` | `WORKKIT_HOME` | `${HOME}/.workkit` |

<!-- END: env-var-table -->

<!-- prettier-ignore-end -->

Harnesses without `roots[]` entries (e.g. `aider`, `cursor`, `continue`, `roo-code`, `boltai`, `windsurf`, `pieces`, `openhands`, and others) use `${HOME}` or `${XDG_*}` directly in their path templates with no env override mechanism.

## Validation behavior

### Unknown harness key

Calling `checkHarness("nonexistent")` throws (TypeScript) or returns an error (Go):

```
Unknown harness: nonexistent
```

### Unresolved template placeholder

If a path template references a variable that is undefined, null, or empty, the **entire path resolves to null** in public APIs, and `exists` is `false`. This is by design — for example, `amazon-q-cli`'s `data-root-env` path resolves to null when `Q_CLI_DATA_DIR` is not set.

### Platform-gated paths

Paths with a `platforms` array are only checked on matching platforms. On non-matching platforms, the path entry is still returned (with `path` and `exists` populated if the template resolves), but it is filtered out before checking. For example, Cursor's `app-macos` path (`/Applications/Cursor.app`) is only checked on `darwin`.

### Non-executable files

On non-Windows platforms, a file found on `PATH` must have the executable bit set (`0o111`) to count as an executable match. A regular file without the executable bit does not trigger detection.

On Windows, any file matching the executable name (with extensions from `PATHEXT`) counts as a match. `PATH` and `PATHEXT` (and `HOME`, `USERPROFILE`, `TMPDIR`) are looked up case-insensitively, so a `Path` key works.

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
    PATH: "/usr/local/bin:/usr/bin",
  },
});

console.log(result.installed); // boolean
console.log(result.executablePath); // string | null
console.log(result.matchedPaths); // array of matched paths
console.log(result.reasons); // e.g. ["executable:codex", "config:config"]
```

> **Privacy:** Result path values—`paths` (the resolved paths), `matchedPaths`, and `executablePath`—can reveal absolute usernames, home directories, project paths, executable paths, and harness config/state paths. Redact them before logs, telemetry, bug reports, screenshots, or analytics.

### Example 3: Reading the registry directly

<!-- prettier-ignore-start -->

<!-- automd:repo-stats section="data-export-example" -->

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harnesses = require("@auron-labs/harness-detect/data");

console.log(harnesses.version);
console.log(harnesses.harnesses.length);  // 145
```

<!-- /automd -->

<!-- prettier-ignore-end -->

### Example 4: Reading support metadata by scope

```js
import { getHarnessSupport } from "@auron-labs/harness-detect";

const codexSupport = getHarnessSupport("codex");

console.log(codexSupport.support.skills.global.paths);
console.log(codexSupport.support.skills.local.paths);
console.log(codexSupport.support.agents.local.status);
console.log(codexSupport.support.agentsSkills.local.status);
```

Use `global` to answer user-level support questions. Use `local` to answer workspace/project questions rooted at `${CWD}`.

## Where each setting is consumed

| Setting | Consumed in (TS) | Consumed in (Go) | Consumed in (Rust) | Consumed in (Python) |
| --- | --- | --- | --- | --- |
| `options.env` | `withDefaults()` in `src/index.js` | `withDefaults()` in `harnessdetect.go` | `with_defaults()` in `src/lib.rs` | `_with_defaults()` in `__init__.py` |
| `options.cwd` | `withDefaults()` → `CWD` | `withDefaults()` → `CWD` | `with_defaults()` → `CWD` | `_with_defaults()` → `CWD` |
| `roots[]` | `resolveHarnessRoots()` in `src/index.js` | `resolveHarnessRoots()` in `harnessdetect.go` | `resolve_harness_roots()` in `src/lib.rs` | `_resolve_harness_roots()` in `__init__.py` |
| `paths[].template` | `resolveTemplate()` in `src/index.js` | `resolveTemplate()` in `harnessdetect.go` | `resolve_template()` in `src/lib.rs` | `_resolve_template()` in `__init__.py` |
| `paths[].platforms` | `platformMatches()` in `src/index.js` | `platformMatches()` in `harnessdetect.go` | `platform_matches()` in `src/lib.rs` | `_platform_matches()` in `__init__.py` |
| `executables[]` | `findExecutable()` in `src/index.js` | `findExecutable()` in `harnessdetect.go` | `find_executable()` in `src/lib.rs` | `_find_executable()` in `__init__.py` |
| `env[]` | Documentation only (not read by code) | Documentation only (not read by code) | Documentation only (not read by code) | Documentation only (not read by code) |
