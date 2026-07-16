# github.com/auron/harness-detect/packages/golang/harnessdetect

Detect installed LLM harnesses and resolve their config/state paths from a curated JSON registry. This is the Go port of `@auron-labs/harness-detect`.

## Status

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

This package is maintained as the Go port of the shared registry-backed library. It is library-only; there is no GoReleaser, Homebrew tap, or binary artifact.

## Installation

```sh
go get github.com/auron/harness-detect/packages/golang/harnessdetect
```

## Quick usage

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

## Detection semantics

A harness counts as installed when either of these is true:

- a matching executable is found on `PATH`
- one or more known config, state, cache, install, or project paths exist

## Exported APIs

- `GetRawHarnessData()` returns the full registry object and is the preferred raw-registry API.
- `GetHarnessMatrix()` is a compatibility alias for `GetRawHarnessData()`.
- `ListHarnesses()` returns the registry's `harnesses` slice.
- `GetHarnessSupport` returns the support metadata for one harness key or alias.
- `ListHarnessSupport()` returns support metadata for every harness.
- `CheckHarness(input, options)` checks one harness key or alias and returns resolved paths, matches, and reasons.
- `DetectHarnesses(options)` checks every registry entry and returns all results.
- `DetectInstalledHarnesses(options)` returns only installed results.

Both `CheckHarness()`, `DetectHarnesses()`, and `DetectInstalledHarnesses()` accept `CheckOptions{ Env, CWD }` overrides for path resolution.

`HarnessDefinition` and `HarnessSupportRecord` expose the shared registry's nested `support` object through exported Go structs (`HarnessSupport`, `HarnessSupportArea`, `HarnessSupportScope`, `HarnessSupportPath`).

### Result JSON null semantics

- This is an intentional Go public API break for strict result-shape parity with the TypeScript package.
- `HarnessCheckResult.ExecutablePath` is now `*string` so missing executable matches marshal as `"executablePath": null`.
- `ResolvedHarnessPath.Path` is now `*string` so unresolved path templates marshal as `"path": null`.

Example consumer checks:

```go
result, _ := harnessdetect.CheckHarness("codex", harnessdetect.CheckOptions{})
if result.ExecutablePath == nil {
	// No executable match; JSON output uses "executablePath": null.
}
```

## Development commands

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference, the registry editing procedure, and change-aware
validation.

## External-consumer smoke test

Validate the real consumer experience from a temporary module outside this
repo. The `require`/`replace` target is the Go module root
`github.com/auron/harness-detect/packages/golang`; the import in Go source is
the subpackage `github.com/auron/harness-detect/packages/golang/harnessdetect`.

```sh
REPO_ROOT="/absolute/path/to/harness-detect"
tmpdir="$(mktemp -d)"

cd "$tmpdir"
go mod init example.com/harness-detect-consumer
go mod edit -require=github.com/auron/harness-detect/packages/golang@v0.0.0
go mod edit -replace=github.com/auron/harness-detect/packages/golang="$REPO_ROOT/packages/golang"

cat > main.go <<'EOF'
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
	fmt.Println(len(results))
}
EOF

go run .
```

Run that from any shell once `REPO_ROOT` points at the local checkout. After a
Go release tag such as `packages/golang/v0.1.1` exists, replace the local
`go mod edit -require ...@v0.0.0` / `-replace ...` steps with:

```sh
go get github.com/auron/harness-detect/packages/golang/harnessdetect@v0.1.1
```

Related guides:

- Harness registry workflow: [../../docs/harness-guide.md](../../docs/harness-guide.md)
- Package parity/API contract: [../../docs/package-guide.md](../../docs/package-guide.md)

When editing registry data, update `packages/data/harnesses.json`, run `mise run registry:sync`, then `mise run registry:check`. CI uses the read-only `registry:check` step to verify the embedded package copy stays aligned.
