# harness-detect

[![License](https://img.shields.io/github/license/auron/harness-detect?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/auron/harness-detect/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/auron/harness-detect/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/auron/harness-detect?style=flat-square)](https://github.com/auron/harness-detect/releases)

Detect installed LLM harnesses such as Codex, Claude Code, Gemini CLI, Cursor,
and others, then resolve their known config, state, cache, install, and project
paths.

`harness-detect` is useful when an app, agent, plugin, or developer tool needs
to adapt to the LLM harnesses already installed on a user's machine without
hardcoding one provider. Detection is data-driven from a shared JSON registry,
so the TypeScript, Go, Rust, and Python packages stay aligned.

## Packages

| Language | Package | Install |
|---|---|---|
| TypeScript / Node.js | `@auron-labs/harness-detect` | `bun add @auron-labs/harness-detect` |
| Go | `github.com/auron/harness-detect/packages/golang/harnessdetect` | `go get github.com/auron/harness-detect/packages/golang/harnessdetect` |
| Rust | `harness-detect` | `cargo add harness-detect` |
| Python | `harness-detect` | `pip install harness-detect` |

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

There is no CLI binary in this repository. These packages are libraries for
embedding detection in your own tools.

## Quick Start

### TypeScript

```js
import { checkHarness, detectInstalledHarnesses } from "@auron-labs/harness-detect";

const installed = detectInstalledHarnesses();
console.log(installed.map((result) => result.key));

const claude = checkHarness("claude-code");
console.log(claude.installed, claude.reasons, claude.matchedPaths);
```

### Go

```go
package main

import (
	"fmt"

	"github.com/auron/harness-detect/packages/golang/harnessdetect"
)

func main() {
	results, err := harnessdetect.DetectInstalledHarnesses(harnessdetect.CheckOptions{})
	if err != nil {
		panic(err)
	}

	for _, result := range results {
		fmt.Println(result.Key, result.Reasons)
	}
}
```

### Rust

```rust
use harness_detect::{detect_installed_harnesses, CheckOptions};

let results = detect_installed_harnesses(&CheckOptions::default())?;
for result in results {
    println!("{}: {:?}", result.key, result.reasons);
}
# Ok::<(), harness_detect::HarnessError>(())
```

### Python

```python
from harness_detect import CheckOptions, detect_installed_harnesses

for result in detect_installed_harnesses(CheckOptions()):
    print(result.key, result.reasons)
```

> **Privacy:** Detection results can expose absolute usernames, home directories,
> project paths, executable paths, and harness config/state paths. Redact the
> resolved path entries (`paths`), `matchedPaths`, and `executablePath` before
> sending results to logs, telemetry, bug reports, screenshots, or analytics.

## How Detection Works

A harness counts as installed when at least one of these checks matches:

1. A known executable is found on `PATH`.
2. A known config, state, cache, install, or project path exists.

The registry contains harness keys, aliases, executable names, path templates,
environment-variable notes, installation metadata, and source URLs. The
canonical registry lives at `packages/data/harnesses.json` and is copied into
each package for distribution.

<!-- automd:repo-stats section="harness-count-sentence" -->

The registry currently covers **51 harnesses**.

<!-- /automd -->

## Configuration

The check APIs accept optional environment and current-working-directory
overrides. Use these when scanning a sandbox, test fixture, alternate home
directory, or project path instead of the current process environment.

```js
import { checkHarness } from "@auron-labs/harness-detect";

const result = checkHarness("codex", {
  env: {
    HOME: "/tmp/fake-home",
    PATH: "/tmp/fake-bin",
    CODEX_HOME: "/tmp/fake-codex",
  },
  cwd: "/tmp/project",
});

console.log(result.resolvedPaths);
```

For raw registry access, prefer the runtime APIs over direct JSON imports:

| Language | Raw registry API |
|---|---|
| TypeScript | `getRawHarnessData()` |
| Go | `GetRawHarnessData()` |
| Rust | `get_harness_matrix()` |
| Python | `get_harness_matrix()` |

## Troubleshooting

If a harness is not detected:

1. Confirm the harness executable is on the same `PATH` visible to your process.
2. Confirm the harness has created one of its known config or state paths.
3. Pass explicit `env` or `cwd` overrides when testing against a fixture or
   non-standard home directory.
4. Check the registry entry in `packages/data/harnesses.json` to see which
   executable names and paths are currently recognized.

If the registry is missing a harness or path, open an issue or pull request
with a source URL for each new executable, path, or environment variable rule.

For detection issues, include the package name/version, applicable runtime
version (Node.js/Bun, Go, Rust, or Python), OS/platform, harness key or alias,
expected versus actual result, sanitized `reasons`, and sanitized `matchedPaths`
and `paths` (resolved-path) summaries. Include environment-root override names
and only redacted values. Do **not** include full environment dumps, token or
secret values, or unredacted absolute paths, usernames, or project names; see
[SUPPORT.md](./SUPPORT.md) for the complete checklist.

## Documentation

- Documentation home: [docs/index.md](./docs/index.md)
- API reference: [docs/api.md](./docs/api.md)
- Registry schema and configuration: [docs/configuration.md](./docs/configuration.md)
- Adding or editing harness entries: [docs/harness-guide.md](./docs/harness-guide.md)
- Package parity and API contract: [docs/package-guide.md](./docs/package-guide.md)
- Support expectations: [SUPPORT.md](./SUPPORT.md)
- Security reporting: [SECURITY.md](./SECURITY.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Development

See [docs/development.md](./docs/development.md) for local setup and package
commands. Maintainers can use [docs/maintainers.md](./docs/maintainers.md) for
the full verification, registry sync, release command reference, and [partial
release recovery](./docs/maintainers.md#partial-release-recovery).

Common root commands:

```sh
mise run verify
mise run registry:sync
mise run registry:check
```

Releases are managed by release-please. Use conventional commits such as
`feat:`, `fix:`, and `feat!:` so release notes and versions are generated
correctly. For the Go subdirectory module, the repository tag format is
`packages/golang/vX.Y.Z` even though consumers install it as
`go get github.com/auron/harness-detect/packages/golang/harnessdetect@vX.Y.Z`.

## License

[MIT](./LICENSE)
