# API reference

All four packages expose the same raw-registry, support-metadata, and
detection operations. For raw registry access, prefer the dedicated raw-data
APIs: TypeScript `getRawHarnessData()`, Go `GetRawHarnessData()`, Rust
`get_raw_harness_data()`, and Python `get_raw_harness_data()`.

Support metadata is descriptive only. Use it to answer questions like "does
this harness document global config support?" or "does it expose local
`${CWD}`-rooted command files?" It does not make a harness count as installed.
See [support-matrix.md](./support-matrix.md) for the category/scope glossary.
The support matrix itself is generated from registry `support` data in
`packages/data/harnesses.json`.

Because the project has not been published yet, the public contract now favors
a clean aligned schema/API over compatibility shims. Registry `version` stays
`1`: adding `support` changed the raw harness shape, but it did not require a
new registry document version for internal tooling.

## TypeScript API

Package: `@auron-labs/harness-detect`
Entry point: `packages/typescript/src/index.js`
Type declarations: `packages/typescript/index.d.ts`

### `getRawHarnessData()`

Returns a deep clone of the full registry object, including descriptive
`installations[]` metadata and required `support` metadata for every harness.
This is the preferred programmatic raw-registry API.

```ts
function getRawHarnessData(): HarnessMatrix
```

```js
import { getRawHarnessData } from "@auron-labs/harness-detect";

const codex = getRawHarnessData().harnesses.find((h) => h.key === "codex");

console.log(codex.installations);
// [{ method: "npm", package: "@openai/codex", command: "npm install -g @openai/codex", platforms: ["darwin", "linux", "win32"] }]
```

### `getHarnessMatrix()`

Alias for `getRawHarnessData()`. Returns the same deep-cloned registry object,
including `installations[]` and required `support` metadata.

```ts
function getHarnessMatrix(): HarnessMatrix
```

**Returns:** `{ version: number; harnesses: HarnessDefinition[] }`

<!-- automd:repo-stats section="get-harness-matrix-example" -->

```js
import { getHarnessMatrix } from "@auron-labs/harness-detect";

const matrix = getHarnessMatrix();
console.log(matrix.version);           // 1
console.log(matrix.harnesses.length);  // 67
```

<!-- /automd -->

### `listHarnesses()`

Returns a deep clone of the `harnesses` array from the registry.

```ts
function listHarnesses(): HarnessDefinition[]
```

```js
import { listHarnesses } from "@auron-labs/harness-detect";

const harnesses = listHarnesses();
console.log(harnesses.map((h) => h.key));
console.log(harnesses[0].support);
```

### `getHarnessAcp(input)` and `listHarnessAcp()`

```ts
function getHarnessAcp(input: string): HarnessAcpRecord
function listHarnessAcp(): HarnessAcpRecord[]
```

Return `{key, name, acp}` records using the same key/alias normalization,
unknown-harness error, and independent snapshots as the support APIs. Stored ACP
is optional during this rollout; these getters return explicit `unknown` when
it is absent. Raw/list/detection surfaces retain stored omission. Python uses
immutable records and represents absent stored ACP as `None`.

Go names these operations `GetHarnessACP` and `ListHarnessACP`; Rust and Python
use `get_harness_acp` and `list_harness_acp`. Support getters continue returning
only support metadata. ACP has no effect on installed status.

```ts
import { getHarnessAcp } from "@auron-labs/harness-detect";

const record = getHarnessAcp("codex");
const acp = record.acp;
const owner = acp.adapter ? getHarnessAcp(acp.adapter) : record;
const launch = owner.acp.launches?.find(
  item => !item.platforms || item.platforms.includes(process.platform)
);
console.log(launch); // undefined if no supported launch matches this OS
console.log(record.acp.notes, owner.acp.notes);
```

Supported ACP describes either a nonempty `launches` list for local stdio or
one `adapter` registry key leading to the launch owner. Multiple recipes have
explicit, non-overlapping platforms. Read the owning harness definition's
`installations` and `env` plus both records' notes for setup requirements.
The library returns metadata; it does not execute commands or check readiness. See [ACP fields and evidence rules](./configuration.md#acp-metadata-acp).

### `getHarnessMcp(input)` and `listHarnessMcp()`

```ts
function getHarnessMcp(input: string): HarnessMcpRecord
function listHarnessMcp(): HarnessMcpRecord[]
```

Return `{key, name, mcp}` records with the same key/alias normalization,
unknown-harness error, and independent copies as the support and ACP getters.
Every harness has explicit `mcp` metadata:

- `mcp.status`: whether the harness can use MCP servers at all.
- `mcp.mcpJson`: whether it reads the project-root `.mcp.json`
  (`{"mcpServers": {...}}`) by default.
- `mcp.global` / `mcp.local`: the user-level and project-level files that store
  MCP servers (`paths`), their `format` (`json`, `jsonc`, `toml`, `yaml`), and the
  `keyPath` the servers live under, e.g. `["mcpServers"]`, `["mcp_servers"]`,
  `["mcp", "servers"]`, or the literal key `["amp.mcpServers"]`. `local` describes
  the harness's native project file; `.mcp.json` support is reported only by
  `mcpJson`.
- `mcp.serverFormat`: the native shape of one server entry, used by
  `translateMcpJson`.

MCP metadata is descriptive and never affects installed status. See
[MCP fields](./configuration.md#mcp-metadata-mcp).

```ts
import { getHarnessMcp } from "@auron-labs/harness-detect";

const { mcp } = getHarnessMcp("codex");
console.log(mcp.status, mcp.mcpJson); // "supported" "unsupported"
console.log(mcp.global.paths[0].template, mcp.global.format, mcp.global.keyPath);
// "${CODEX_ROOT}/config.toml" "toml" ["mcp_servers"]
```

### `translateMcpJson(input, mcpJson, options?)`

```ts
function translateMcpJson(
  input: string,
  mcpJson: McpJsonDocument | string,
  options?: { scope?: "global" | "local" } // default "local"
): McpTranslation

interface McpTranslation {
  key: string;
  name: string;
  scope: "global" | "local";
  format: "json" | "jsonc" | "toml" | "yaml";
  keyPath: [string, ...string[]];
  servers: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  config: Record<string, unknown>; // servers nested under keyPath
  skipped: { name: string; reason: string }[];
}
```

Translates the servers of a `.mcp.json` document into the harness's native
server entries for one scope. The function is pure: it reads no files, writes
nothing, and returns a plain object. Serialize `config` with your own
JSON/TOML/YAML writer and merge it into one of the scope's `paths`.

Each `.mcp.json` server is classified by `type` (`stdio`, `http`, `sse`), or by
`command` (stdio) / `url` (http) when `type` is absent. Only `command`, `args`,
`env`, `url`, and `headers` are translated; other fields are ignored. Values such
as `${TOKEN}` are copied verbatim. Servers are processed in sorted name order,
and a server is listed in `skipped` instead of being partially translated when:

| `reason` | Cause |
| --- | --- |
| `invalid server entry` | The entry is not an object, or `type` is not a string. |
| `unsupported transport: <type>` | `type` is not stdio/http/sse, or the harness cannot use that transport. |
| `missing command or url` | No `type`, `command`, or `url`. |
| `missing command` / `missing url` | The field is absent or empty. |
| `invalid args` / `invalid env` / `invalid headers` | Not a string array / object of strings. |
| `env not supported` / `headers not supported` | The server sets them but the native format has no field for them. |

It throws `Unknown harness: <input>`, `Unknown MCP scope: <scope>`,
`Harness <key> has no file-based MCP config for scope <scope>` (MCP unsupported
or unknown, or the scope has no config file), or
`.mcp.json must be an object with an mcpServers object`.

```ts
import { translateMcpJson } from "@auron-labs/harness-detect";

const result = translateMcpJson("codex", {
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${TOKEN}" } },
    legacy: { type: "sse", url: "https://example.com/sse" }
  }
}, { scope: "global" });

result.format;  // "toml"
result.config;  // { mcp_servers: { docs: { url, http_headers }, fs: { command, args } } }
result.skipped; // [{ name: "legacy", reason: "unsupported transport: sse" }]
```

### `detectInstalledAcpLaunches(options?)`

```ts
function detectInstalledAcpLaunches(options?: CheckHarnessOptions): InstalledAcpLaunch[]

interface InstalledAcpLaunch {
  key: string;
  name: string;
  command: string; // absolute path
  args: string[];
}
```

Lists ACP agents that can be started from binaries already installed, without
fetching packages. For each registry entry, in registry order:

1. `acp.status` must be `supported`.
2. Entries with an `adapter` are skipped. The adapter's own entry is returned
   when it is installed, so there are no duplicates and no base CLI is offered
   without its adapter.
3. `installedLaunches` is used when present; otherwise `launches` without
   package-runner recipes (`npx`, `bunx`, `uvx`, `pnpm dlx`).
4. The recipe for the current platform is selected.
5. `command` is resolved on `PATH` using the same lookup as harness detection,
   honouring `options.env`. The entry is omitted unless the result is an
   absolute path to an executable file; relative `PATH` entries are ignored.

The detected `executablePath` is not used: a harness can be detected at `cursor`
while its ACP launch is `cursor-agent`. The call does not execute, install, or
probe anything.

Go names this `DetectInstalledACPLaunches(options) ([]InstalledACPLaunch, error)`;
Rust and Python use `detect_installed_acp_launches`, returning
`Vec<InstalledAcpLaunch>` and `list[InstalledAcpLaunch]`.

```ts
import { detectInstalledAcpLaunches } from "@auron-labs/harness-detect";

for (const { key, command, args } of detectInstalledAcpLaunches()) {
  console.log(key, command, args); // e.g. gemini-cli /usr/local/bin/gemini ["--acp"]
}
```

### `getHarnessSupport(input)`

Returns one harness's support metadata by key or alias.

```ts
function getHarnessSupport(input: string): HarnessSupportRecord
```

### `listHarnessSupport()`

Returns support metadata for every harness.

```ts
function listHarnessSupport(): HarnessSupportRecord[]
```

### Reading global vs local support data

`support.global` describes user-level or machine-level surfaces outside a
workspace. `support.local` describes project/workspace-local surfaces rooted at
`${CWD}`.

For an at-a-glance cross-harness view of the same `global` and `local`
surfaces, see [support-matrix.md](./support-matrix.md).

```js
import { getHarnessSupport } from "@auron-labs/harness-detect";

const support = getHarnessSupport("claude-code");

console.log(support.support.config.global.status);
console.log(support.support.config.local.status);

console.log(support.support.commands.local.paths);
console.log(support.support.agentsSkills.local.paths);
```

- `config` = config files/directories
- `skills` = skills/prompts surfaces
- `commands` = slash commands or command packs
- `agents` = agent definition/manifests
- `agentsSkills` = discovery of Agent Skills from the shared `.agents/skills` directory (`${HOME}/.agents/skills` globally, `${CWD}/.agents/skills` locally); vendor directories such as `.claude/skills` belong under `skills`

When you need all harnesses' support summaries without the rest of the raw
registry, prefer `listHarnessSupport()`.

```js
import { listHarnessSupport } from "@auron-labs/harness-detect";

const localCommandHarnesses = listHarnessSupport().filter(
  (entry) => entry.support.commands.local.status === "supported"
);

console.log(localCommandHarnesses.map((entry) => entry.key));
```

### `checkHarness(input, options?)`

Checks a single harness by key or alias. Returns resolved paths, matched paths,
and reasons. Detection behavior is unchanged by `support`: installed status
still depends only on executable matches and existing resolved `paths[]`
entries.

```ts
function checkHarness(input: string, options?: CheckHarnessOptions): HarnessCheckResult
```

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input` | string | yes | Harness key or alias (case-insensitive, trimmed). |
| `options.env` | `Record<string, string \| undefined>` | no | Environment to use instead of `process.env`. |
| `options.cwd` | string | no | Working directory (defaults to `process.cwd()`). |

**Throws:** `Error("Unknown harness: <input>")` if the key/alias is not found.

**Returns:** `HarnessCheckResult` (see below).

```js
import { checkHarness } from "@auron-labs/harness-detect";

const result = checkHarness("claude-code", {
  cwd: "/my/project",
  env: { HOME: "/Users/test", PATH: "/usr/local/bin" }
});

console.log(result.installed);        // boolean
console.log(result.executablePath);   // string | null
console.log(result.matchedPaths);     // ResolvedHarnessPath[]
console.log(result.reasons);          // string[]
```

> **Privacy:** `paths` contains all resolved path entries (sometimes described
> as resolved paths; there is no separate `resolvedPaths` result field), and
> `matchedPaths` and `executablePath` can contain absolute usernames, home
> directories, project paths, executable paths, and harness config/state paths.
> Redact them before including results in logs, telemetry, bug reports,
> screenshots, or analytics.

### `detectHarnesses(options?)`

Checks every harness in the registry. Returns an array of results.

```ts
function detectHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[]
```

```js
import { detectHarnesses } from "@auron-labs/harness-detect";

const installed = detectHarnesses().filter((r) => r.installed);
console.log(installed.map((r) => r.key));
```

### `detectInstalledHarnesses(options?)`

Checks every harness in the registry and returns only installed results.

```ts
function detectInstalledHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[]
```

### TypeScript types

```ts
type HarnessPathCategory = "install" | "config" | "state" | "cache" | "project";

interface HarnessEnvVar {
  name: string;
  description: string;
}

interface HarnessPathSpec {
  id: string;
  category: HarnessPathCategory;
  kind: "file" | "dir";
  template: string;
  platforms?: NodeJS.Platform[];
}

interface HarnessRootDef {
  name: string;
  env?: string;
  use?: string;
  fallbackEnv?: string;
  fallback: string;
}

type HarnessInstallMethod =
  | "npm"
  | "homebrew"
  | "pip"
  | "pipx"
  | "uv"
  | "cargo"
  | "go"
  | "script"
  | "manual"
  | "marketplace"
  | "binary"
  | "unknown";

interface HarnessInstallation {
  method: HarnessInstallMethod;
  package?: string;
  command?: string;
  url?: string;
  marketplace?: string;
  id?: string;
  platforms?: NodeJS.Platform[];
  notes?: string;
}

interface HarnessDefinition {
  key: string;
  name: string;
  version: string; // upstream version the entry was verified against, or "unknown"
  aliases: string[];
  executables: string[];
  installations: HarnessInstallation[];
  paths: HarnessPathSpec[];
  roots?: HarnessRootDef[];
  env: HarnessEnvVar[];
  sources: string[];
  support: HarnessSupport;
  acp?: HarnessAcp;
  mcp: HarnessMcp;
}

interface HarnessMatrix {
  version: number;
  harnesses: HarnessDefinition[];
}

type HarnessSupportStatus = "supported" | "unsupported" | "unknown";
type HarnessSupportConfidence =
  | "official"
  | "source"
  | "observed"
  | "inferred"
  | "unknown";

interface HarnessSupportPath {
  id: string;
  kind: "file" | "dir";
  template: string;
  platforms?: NodeJS.Platform[];
  description?: string;
}

interface HarnessSupportLeaf {
  status: HarnessSupportStatus;
  confidence: HarnessSupportConfidence;
  paths: HarnessSupportPath[];
  sources: string[];
  notes?: string;
}

interface HarnessSupportScopePair {
  global: HarnessSupportLeaf;
  local: HarnessSupportLeaf;
}

interface HarnessSupport {
  config: HarnessSupportScopePair;
  skills: HarnessSupportScopePair;
  commands: HarnessSupportScopePair;
  agents: HarnessSupportScopePair;
  agentsSkills: HarnessSupportScopePair;
}

interface HarnessAcpLaunch {
  command: string;
  args: string[];
  platforms?: HarnessPlatform[];
}

type HarnessAcp = {
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
} & (
  | { status: "supported"; launches: [HarnessAcpLaunch, ...HarnessAcpLaunch[]]; adapter?: never }
  | { status: "supported"; adapter: string; launches?: never }
  | { status: "unsupported" | "unknown"; launches?: never; adapter?: never }
);

interface HarnessAcpRecord {
  key: string;
  name: string;
  acp: HarnessAcp;
}

interface HarnessSupportRecord {
  key: string;
  name: string;
  support: HarnessSupport;
}

interface HarnessMcpScope {
  status: HarnessSupportStatus;
  paths: HarnessSupportPath[];
  format?: "json" | "jsonc" | "toml" | "yaml"; // when supported with paths
  keyPath?: [string, ...string[]];            // when supported with paths
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
}

interface HarnessMcpServerFormat {
  container: "map" | "array";
  nameField?: string;
  typeField?: string;
  stdio: { type?: string; command: string; args?: string; env?: string };
  http?: { type?: string; url: string; headers?: string };
  sse?: { type?: string; url: string; headers?: string };
  defaults?: Record<string, string | number | boolean>;
}

interface HarnessMcp {
  status: HarnessSupportStatus;
  mcpJson: HarnessSupportStatus;
  global: HarnessMcpScope;
  local: HarnessMcpScope;
  serverFormat?: HarnessMcpServerFormat;
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
}

interface HarnessMcpRecord {
  key: string;
  name: string;
  mcp: HarnessMcp;
}

interface ResolvedHarnessPath extends HarnessPathSpec {
  path: string | null;
  exists: boolean;
}

interface CheckHarnessOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

interface HarnessCheckResult {
  key: string;
  name: string;
  installed: boolean;
  executablePath: string | null;
  harness: HarnessDefinition;
  paths: ResolvedHarnessPath[];
  matchedPaths: ResolvedHarnessPath[];
  reasons: string[];
}
```

`installations[]` and `support` are public registry metadata. They are returned
by `getRawHarnessData()`, `getHarnessMatrix()`, `listHarnesses()`, and the
embedded `harness` field on detection results. `getHarnessSupport()` and
`listHarnessSupport()` expose just the support subset. None of that metadata is
detection evidence: detection still depends only on executable matches and
existing resolved `paths[]` entries.

For cross-language usage, the same support categories and `global`/`local`
scopes are exposed in Go, Rust, and Python under idiomatic function/type names.
Use the dedicated support APIs when you only need support metadata rather than
the full raw registry.

If you are documenting or reviewing those APIs, keep the generated
[support-matrix.md](./support-matrix.md) in sync with the underlying registry
data via `mise run docs:support-matrix:generate` and `mise run docs:check`.

Installation metadata uses the same `process.platform` vocabulary as the schema:
`aix`, `android`, `cygwin`, `darwin`, `freebsd`, `haiku`, `linux`, `netbsd`,
`openbsd`, `sunos`, `win32`.

### Installation method semantics

| `method` | Meaning |
|---|---|
| `npm`, `homebrew`, `pip`, `pipx`, `uv`, `cargo`, `go` | Package-manager install documented by the harness. |
| `script` | Installer shell/PowerShell script or bootstrap command. |
| `manual`, `binary` | Direct download or manual install flow. |
| `marketplace` | Editor/marketplace-distributed install; pair with `marketplace` and `id` when known. |
| `unknown` | Upstream docs confirm the harness exists, but the install method should not be guessed from incomplete evidence. |

### Subpath export: `@auron-labs/harness-detect/data`

The raw JSON registry is also exported as a subpath import:

<!-- automd:repo-stats section="data-export-example" -->

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harnesses = require("@auron-labs/harness-detect/data");

console.log(harnesses.version);
console.log(harnesses.harnesses.length);  // 67
```

<!-- /automd -->

This exports the file at `packages/typescript/data/harnesses.json`. Prefer
`getRawHarnessData()` for programmatic access; both surfaces include
`installations[]` and required `support` metadata.

## Go API

Import path: `github.com/auron-labs/harness-detect/packages/golang/harnessdetect`
Module root: `github.com/auron-labs/harness-detect/packages/golang`
Entry point: `packages/golang/harnessdetect/harnessdetect.go`

### `GetHarnessMatrix()`

Compatibility alias for `GetRawHarnessData()`. Returns a copy of the loaded
harness matrix, including `installations[]` metadata.

```go
func GetHarnessMatrix() HarnessMatrix
```

### `GetRawHarnessData()`

Returns a copy of the loaded harness matrix, including descriptive
`Installations` metadata and required `Support` metadata for every harness.
This is the preferred programmatic raw-registry API.

```go
func GetRawHarnessData() HarnessMatrix
```

### `ListHarnesses()`

Returns a copy of the harness definitions slice.

```go
func ListHarnesses() []HarnessDefinition
```

### `GetHarnessACP(input)` and `ListHarnessACP()`

```go
func GetHarnessACP(input string) (HarnessACPRecord, error)
func ListHarnessACP() []HarnessACPRecord
```

Return ACP records with the same lookup and copy behavior as support records.
See the [shared ACP API contract](#getharnessacpinput-and-listharnessacp).

### `GetHarnessMCP(input)`, `ListHarnessMCP()`, and `TranslateMCPJSON(input, mcpJSON, options)`

```go
func GetHarnessMCP(input string) (HarnessMCPRecord, error)
func ListHarnessMCP() []HarnessMCPRecord
func TranslateMCPJSON(input string, mcpJSON []byte, options MCPTranslateOptions) (MCPTranslation, error)

type MCPTranslateOptions struct {
	Scope string // "global" or "local"; empty means "local"
}

type MCPTranslation struct {
	Key, Name, Scope, Format string
	KeyPath []string
	Servers any            // map[string]any, or []any for array containers
	Config  map[string]any // Servers nested under KeyPath
	Skipped []MCPSkippedServer
}
```

Same metadata, translation rules, skip reasons, and error messages as the
[TypeScript MCP API](#getharnessmcpinput-and-listharnessmcp). `HarnessMCP.MCPJSON`
holds the JSON `mcpJson` field. A malformed `mcpJSON` byte slice returns the
wrapped `encoding/json` error.

### `DetectInstalledACPLaunches(options)`

```go
type InstalledACPLaunch struct {
	Key     string
	Name    string
	Command string // absolute path
	Args    []string
}

func DetectInstalledACPLaunches(options CheckOptions) ([]InstalledACPLaunch, error)
```

Lists ACP agents that can be started from installed binaries. See the
[shared contract](#detectinstalledacplaunchesoptions).

### `GetHarnessSupport(input)`

Returns one harness's support metadata by key or alias.

```go
func GetHarnessSupport(input string) (HarnessSupportRecord, error)
```

### `ListHarnessSupport()`

Returns support metadata for all harnesses.

```go
func ListHarnessSupport() []HarnessSupportRecord
```

### `CheckHarness(input, options)`

Checks a single harness by key or alias.

```go
func CheckHarness(input string, options CheckOptions) (HarnessCheckResult, error)
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `input` | string | Harness key or alias (case-insensitive, trimmed). |
| `options.Env` | `map[string]string` | Environment to use. If nil, defaults are computed. |
| `options.CWD` | string | Working directory. |

**Returns:** `(HarnessCheckResult, error)` — error is non-nil if the harness is
unknown.

### `DetectHarnesses(options)`

Checks every harness in the registry.

```go
func DetectHarnesses(options CheckOptions) ([]HarnessCheckResult, error)
```

### `DetectInstalledHarnesses(options)`

Checks every harness in the registry and returns only installed results.

```go
func DetectInstalledHarnesses(options CheckOptions) ([]HarnessCheckResult, error)
```

### Go types

```go
type CheckOptions struct {
    Env map[string]string
    CWD string
}

type HarnessCheckResult struct {
    Key            string
    Name           string
    Installed      bool
    ExecutablePath *string
    Harness        HarnessDefinition
    Paths          []ResolvedHarnessPath
    MatchedPaths   []ResolvedHarnessPath
    Reasons        []string
}

type HarnessDefinition struct {
    Key         string
    Name        string
    Aliases     []string
    Executables []string
    Installations []HarnessInstallation
    Paths       []HarnessPathSpec
    Roots       []HarnessRootDef
    Support     HarnessSupport
    ACP         *HarnessACP
    Env         []HarnessEnvVar
    Sources     []string
}

type HarnessInstallation struct {
    Method      string
    Package     string
    Command     string
    URL         string
    Marketplace string
    ID          string
    Platforms   []string
    Notes       string
}

type HarnessPathSpec struct {
    ID        string
    Category  string
    Kind      string
    Template  string
    Platforms []string
}

type ResolvedHarnessPath struct {
    HarnessPathSpec
    Path   *string
    Exists bool
}
```

`GetRawHarnessData()`, `GetHarnessMatrix()`, `ListHarnesses()`, and
`HarnessCheckResult.Harness` all expose the same registry metadata, including
`Installations` and required `Support`. `GetHarnessSupport()` and
`ListHarnessSupport()` expose just the support subset. Optional `ACP` is a
`*HarnessACP` containing `Status`, `Launches`, `Adapter`, `Sources`, `Confidence`,
and `Notes`. `Launches` is a slice of `HarnessACPLaunch` values holding `Command`, `Args`, and `Platforms`;
`HarnessACPRecord` holds `Key`, `Name`, and `ACP`. That metadata is
descriptive only and does not make a harness count as installed.

## Rust API

Crate: `harness-detect`
Entry point: `packages/rust/src/lib.rs`

- `get_raw_harness_data() -> HarnessMatrix`
- `get_harness_matrix() -> HarnessMatrix`
- `list_harnesses() -> Vec<HarnessDefinition>`
- `get_harness_acp(input) -> Result<HarnessAcpRecord, HarnessError>`
- `list_harness_acp() -> Vec<HarnessAcpRecord>`
- `detect_installed_acp_launches(options) -> Vec<InstalledAcpLaunch>`
- `get_harness_mcp(input) -> Result<HarnessMcpRecord, HarnessError>`
- `list_harness_mcp() -> Vec<HarnessMcpRecord>`
- `translate_mcp_json(input, &mcp_json, &McpTranslateOptions) -> Result<McpTranslation, HarnessError>`
- `get_harness_support(input) -> Result<HarnessSupportRecord, HarnessError>`
- `list_harness_support() -> Vec<HarnessSupportRecord>`
- `check_harness(input, options) -> Result<HarnessCheckResult, HarnessError>`
- `detect_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`
- `detect_installed_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`

Rust uses the same raw registry shape, including `installations[]` and required
`support`, and the same detection semantics. Optional ACP is
`Option<HarnessAcp>` on `HarnessDefinition`; `HarnessAcpLaunch` describes the
command and argv, and `HarnessAcpRecord` is the getter/list result. See the
[shared ACP API contract](#getharnessacpinput-and-listharnessacp).
`HarnessDefinition.mcp` is a required `HarnessMcp`; `translate_mcp_json` takes a
`serde_json::Value` and returns `servers`/`config` as `serde_json::Value`. See the
[shared MCP API contract](#getharnessmcpinput-and-listharnessmcp).

## Python API

Package: `harness-detect`
Entry point: `packages/python/src/harness_detect/__init__.py`

- `get_raw_harness_data() -> HarnessMatrix`
- `get_harness_matrix() -> HarnessMatrix`
- `list_harnesses() -> list[HarnessDefinition]`
- `get_harness_acp(input) -> HarnessAcpRecord`
- `list_harness_acp() -> list[HarnessAcpRecord]`
- `detect_installed_acp_launches(options=None) -> list[InstalledAcpLaunch]`
- `get_harness_mcp(input) -> HarnessMcpRecord`
- `list_harness_mcp() -> list[HarnessMcpRecord]`
- `translate_mcp_json(input, mcp_json, *, scope="local") -> McpTranslation`
- `get_harness_support(input) -> HarnessSupportRecord`
- `list_harness_support() -> list[HarnessSupportRecord]`
- `check_harness(input, options=None) -> HarnessCheckResult`
- `detect_harnesses(options=None) -> list[HarnessCheckResult]`
- `detect_installed_harnesses(options=None) -> list[HarnessCheckResult]`

Python uses the same raw registry shape, including `installations[]` and
required `support`, and the same detection semantics. `HarnessDefinition.acp`
is `HarnessAcp | None`; the frozen `HarnessAcp`, `HarnessAcpLaunch`, and
`HarnessAcpRecord` dataclasses use tuples for arrays. See the
[shared ACP API contract](#getharnessacpinput-and-listharnessacp).
`HarnessDefinition.mcp` is a frozen `HarnessMcp` (`mcp_json`, `global_`, `local`,
`server_format`); `translate_mcp_json` accepts a mapping or JSON text, raises
`HarnessError`, and returns an `McpTranslation` with plain `dict`/`list` values.
See the [shared MCP API contract](#getharnessmcpinput-and-listharnessmcp).

### Go usage example

```go
package main

import (
    "fmt"

    "github.com/auron-labs/harness-detect/packages/golang/harnessdetect"
)

func main() {
    results, _ := harnessdetect.DetectHarnesses(harnessdetect.CheckOptions{})
    for _, r := range results {
        if r.Installed {
            fmt.Println(r.Key, r.Reasons)
        }
    }
}
```

## Return value semantics

### `installed`

`true` when **either**:
- An executable from `executables[]` is found on `PATH` (and is executable on
  non-Windows), **or**
- One or more paths from `paths[]` exist on disk (matching their `kind`).

### `executablePath`

The full path to the matched executable. In Go this is a nil `*string` when no
executable was found, and it marshals to JSON `null`.

### `paths`

All resolved path entries (including non-existent ones), filtered by platform.
Each entry has `path` (resolved template or null; in Go this is a nil `*string`
when unresolved and marshals to JSON `null`) and `exists` (boolean).

### `matchedPaths`

Subset of `paths` where `exists` is `true`.

`paths` (the resolved paths), `matchedPaths`, and `executablePath` may expose
absolute usernames, home directories, project paths, executable paths, and
harness config/state paths. Redact those values before logs, telemetry, bug
reports, screenshots, or analytics.

### `reasons`

Array of strings explaining why the harness counts as installed:
- `"executable:<basename>"` for each executable match.
- `"<category>:<id>"` for each matched path (e.g. `"config:settings"`).

## Key and alias lookup

Lookup is case-insensitive and trimmed. Both `key` and all `aliases[]` are
checked. For example, `checkHarness("Claude")`, `checkHarness("claude")`, and
`checkHarness("claude-code")` all resolve to the same harness.
