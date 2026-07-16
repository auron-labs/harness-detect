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
console.log(matrix.harnesses.length);  // 51
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
console.log(support.support.dotAgents.local.paths);
```

- `config` = config files/directories
- `skills` = skills/prompts surfaces
- `commands` = slash commands or command packs
- `agents` = agent definition/manifests
- `dotAgents` = `.agents`-style support when distinct from `agents`

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
  aliases: string[];
  executables: string[];
  installations: HarnessInstallation[];
  paths: HarnessPathSpec[];
  roots?: HarnessRootDef[];
  env: HarnessEnvVar[];
  sources: string[];
  support: HarnessSupport;
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
  dotAgents: HarnessSupportScopePair;
}

interface HarnessSupportRecord {
  key: string;
  name: string;
  support: HarnessSupport;
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
console.log(harnesses.harnesses.length);  // 51
```

<!-- /automd -->

This exports the file at `packages/typescript/data/harnesses.json`. Prefer
`getRawHarnessData()` for programmatic access; both surfaces include
`installations[]` and required `support` metadata.

## Go API

Import path: `github.com/auron/harness-detect/packages/golang/harnessdetect`
Module root: `github.com/auron/harness-detect/packages/golang`
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
`ListHarnessSupport()` expose just the support subset. That metadata is
descriptive only and does not make a harness count as installed.

## Rust API

Crate: `harness-detect`
Entry point: `packages/rust/src/lib.rs`

- `get_raw_harness_data() -> HarnessMatrix`
- `get_harness_matrix() -> HarnessMatrix`
- `list_harnesses() -> Vec<HarnessDefinition>`
- `get_harness_support(input) -> Result<HarnessSupportRecord, HarnessError>`
- `list_harness_support() -> Vec<HarnessSupportRecord>`
- `check_harness(input, options) -> Result<HarnessCheckResult, HarnessError>`
- `detect_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`
- `detect_installed_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>`

Rust uses the same raw registry shape, including `installations[]` and required
`support`, and the same detection semantics.

## Python API

Package: `harness-detect`
Entry point: `packages/python/src/harness_detect/__init__.py`

- `get_raw_harness_data() -> HarnessMatrix`
- `get_harness_matrix() -> HarnessMatrix`
- `list_harnesses() -> list[HarnessDefinition]`
- `get_harness_support(input) -> HarnessSupportRecord`
- `list_harness_support() -> list[HarnessSupportRecord]`
- `check_harness(input, options=None) -> HarnessCheckResult`
- `detect_harnesses(options=None) -> list[HarnessCheckResult]`
- `detect_installed_harnesses(options=None) -> list[HarnessCheckResult]`

Python uses the same raw registry shape, including `installations[]` and
required `support`, and the same detection semantics.

### Go usage example

```go
package main

import (
    "fmt"

    "github.com/auron/harness-detect/packages/golang/harnessdetect"
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
