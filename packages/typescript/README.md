# @auron-labs/harness-detect

Detect installed LLM harnesses and resolve their config/state paths from a curated JSON registry. The package is dependency-free and targets Node.js 18+.

This is the TypeScript package in a multi-language monorepo that also includes Go, Rust, and Python ports.

## Installation

```sh
bun add @auron-labs/harness-detect
```

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

## Quick usage

```js
import { checkHarness, detectHarnesses } from "@auron-labs/harness-detect";

const installed = detectHarnesses().filter((result) => result.installed);
const claude = checkHarness("claude-code");

console.log(installed.map((result) => result.key));
console.log(claude.installed, claude.reasons, claude.matchedPaths);
```

## Detection semantics

A harness counts as installed when either of these is true:

- a matching executable is found on `PATH`
- one or more known config, state, cache, install, or project paths exist

## Exported APIs

- `getRawHarnessData()` returns the full registry object and is the preferred raw-registry API.
- `getHarnessMatrix()` is a backwards-compatible alias for `getRawHarnessData()`.
- `listHarnesses()` returns the registry's `harnesses` array.
- `getHarnessSupport` returns support metadata for one harness key or alias.
- `listHarnessSupport()` returns support metadata for every harness.
- `checkHarness(input, options?)` checks one harness key or alias and returns resolved paths, matches, and reasons.
- `detectHarnesses(options?)` checks every registry entry and returns all results.
- `detectInstalledHarnesses(options?)` returns only installed results.

Both `checkHarness()`, `detectHarnesses()`, and `detectInstalledHarnesses()` accept optional `{ env, cwd }` overrides for path resolution.

## Exported data registry

The preferred programmatic raw-registry API is `getRawHarnessData()`. The package also keeps the `@auron-labs/harness-detect/data` JSON export for direct registry access.

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harnesses = require("@auron-labs/harness-detect/data");

console.log(harnesses.version);
console.log(harnesses.harnesses.length);
```

The package exports its local copy at `data/harnesses.json`, and the canonical monorepo source of truth lives at `packages/data/harnesses.json`. Each entry includes executables, path templates, environment variable notes, and source URLs used to curate the metadata.

## Development commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, smoke test details, and the registry editing procedure.

Related guides:

- Harness registry workflow: [../../docs/harness-guide.md](../../docs/harness-guide.md)
- Package parity/API contract: [../../docs/package-guide.md](../../docs/package-guide.md)

When editing registry data, update `packages/data/harnesses.json`, run `mise run registry:sync`, then `mise run registry:check`. CI uses the read-only `registry:check` step; the `./data` export remains supported for existing consumers.

## Support and contribution docs

- Security reporting: [../../SECURITY.md](../../SECURITY.md)
- Support expectations: [../../SUPPORT.md](../../SUPPORT.md)
- Contribution and registry evidence requirements: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
