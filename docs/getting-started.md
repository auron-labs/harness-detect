# Getting started

This guide gets you from a fresh clone to a working detection call in minutes.

## Prerequisites

| Requirement | Version | Why |
|---|---|---|
| Node.js | >= 18 | TypeScript package runtime (`package.json` `engines.node`) |
| Go | 1.26.4 | Go package (`go.mod`); only needed for Go development |
| Rust | stable | Rust package (`packages/rust`); only needed for Rust development |
| Python | >= 3.10 | Python package (`pyproject.toml` `requires-python`); only needed for Python development |
| [bun](https://bun.sh) | 1.3.14 | Package manager and script runner for the TypeScript package |
| [uv](https://docs.astral.sh/uv/) | latest | Python package manager and test runner |
| Docker | optional | Only for the Docker smoke test (`bun run smoke:fixtures`) |
| [mise](https://mise.jdx.dev/) | optional | Provides task shortcuts from the repo root |

The TypeScript package has **zero runtime dependencies**. The only dev
dependency is `typescript` (for type-checking). The Go package has **no external
dependencies**. The Rust crate depends on `serde` and `serde_json` (Rust's
stdlib has no JSON support). The Python package is **stdlib-only at runtime**.

## Install the TypeScript package (consumer)

```sh
bun add @auron-labs/harness-detect
```

## Install the Go package (consumer)

```sh
go get github.com/auron/harness-detect/packages/golang/harnessdetect
```

## Install the Rust package (consumer)

```sh
cargo add harness-detect
```

## Install the Python package (consumer)

```sh
pip install harness-detect
```

## Local development setup

Clone the repo, then install TypeScript dev dependencies:

```sh
cd packages/typescript
bun install
```

No install step is needed for the Go package — `go test` fetches modules
automatically. For Rust, `cargo test` fetches crates automatically. For Python,
install dev dependencies with `uv sync --dev` from `packages/python`.

## First successful run

### TypeScript

From `packages/typescript`, run a one-off detection against your real
environment:

```sh
cd packages/typescript
node --input-type=module -e "import { detectHarnesses } from './src/index.js'; console.log(detectHarnesses().filter(r => r.installed).map(r => r.key))"
```

This prints the keys of every harness detected as installed on your machine.

### Go

From `packages/golang`, run the package test suite:

```sh
cd packages/golang
go test ./...
```

This is the quickest verification path in this repository. For consumer code,
import `github.com/auron/harness-detect/packages/golang/harnessdetect` and call the public API.

### Rust

From `packages/rust`, run the package test suite:

```sh
cd packages/rust
cargo test
```

### Python

From `packages/python`, install dev dependencies and run the test suite:

```sh
cd packages/python
uv sync --dev
uv run pytest
```

## Verify the setup worked

### Run the test suites

**TypeScript** (from `packages/typescript`):

```sh
bun test
```

Expected: all tests pass, exit 0.

**Go** (from `packages/golang`):

```sh
go test ./...
```

Expected: all tests pass, exit 0.

**Rust** (from `packages/rust`):

```sh
cargo test
```

Expected: all tests pass, exit 0.

**Python** (from `packages/python`):

```sh
uv run pytest
```

Expected: all tests pass, exit 0.

### Run the local smoke test

This is the hermetic fixture test that CI runs. It creates fake executables and
fake config/state paths in a temp directory — it does **not** install real
harnesses.

```sh
cd packages/typescript
bun run smoke:fixtures:local
```

Expected: exit 0 and a JSON summary with fields `platform`, `exercisedCount`,
`skippedCount`, `exercised`, and `skipped`.

### Verify registry sync

From the repo root:

```sh
cmp -s packages/data/harnesses.json packages/typescript/data/harnesses.json && echo "TS copy OK"
cmp -s packages/data/harnesses.json packages/golang/harnessdetect/data/harnesses.json && echo "Go copy OK"
cmp -s packages/data/harnesses.json packages/rust/data/harnesses.json && echo "Rust copy OK"
cmp -s packages/data/harnesses.json packages/python/src/harness_detect/data/harnesses.json && echo "Python copy OK"
```

Each command should print `OK`. This is also available as `mise run registry:check`.

## Using mise shortcuts (optional)

If you use [mise](https://mise.jdx.dev/), the root `mise.toml` provides
package-scoped tasks that run from the correct working directories:

```sh
mise run test          # Package tests
mise run smoke         # Local hermetic TypeScript smoke test
mise run verify        # Full release verification suite
mise tasks             # List all available tasks
```

## Common next steps

- Read [api.md](./api.md) for the full function signatures and return types.
- Read [configuration.md](./configuration.md) to understand path templates,
  env overrides, and the registry schema.
- Read [development.md](./development.md) for the repository layout and
  contribution workflow.
- Read [testing.md](./testing.md) for the full test strategy.
