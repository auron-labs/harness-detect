# harness-detect

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![CI](https://github.com/auron/harness-detect/actions/workflows/ci.yml/badge.svg)](https://github.com/auron/harness-detect/actions/workflows/ci.yml)

Detect installed LLM harnesses (Codex, Claude Code, Gemini CLI, Cursor, and
others) and resolve their config/state paths from an embedded JSON registry.

This is the Rust port of `@auron-labs/harness-detect`. It shares the same harness
registry as the TypeScript, Go, and Python packages and exposes the same API
surface, adapted to idiomatic Rust naming.

## Installation

```toml
[dependencies]
harness-detect = "0.1"
```

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

## Quick usage

```rust
use harness_detect::{check_harness, detect_installed_harnesses, get_harness_support, CheckOptions};

// Detect all installed harnesses
let results = detect_installed_harnesses(CheckOptions::default())
    .expect("failed to detect harnesses");
for r in &results {
    if r.installed {
        println!("{}: {:?}", r.key, r.reasons);
    }
}

// Check a single harness by key or alias
let claude = check_harness("claude-code", CheckOptions::default())
    .expect("harness not found");
println!("installed: {}", claude.installed);
println!("matched paths: {:?}", claude.matched_paths);

// Read support metadata for one harness
let codex = get_harness_support("codex")
    .expect("support metadata not found");
println!("config support: {}", codex.support.config.global.status);
```

## Detection semantics

A harness counts as installed when either of these is true:

- a matching executable is found on `PATH`
- one or more known config, state, cache, install, or project paths exist

## Exported API

- `get_raw_harness_data()` returns the full registry object.
- `get_harness_matrix()` returns the full registry object.
- `list_harnesses()` returns the registry's `harnesses` vector.
- `get_harness_support(input) -> Result<HarnessSupportRecord, HarnessError>` returns support metadata for one harness key or alias.
- `list_harness_support() -> Vec<HarnessSupportRecord>` returns support metadata for every harness.
- `check_harness(input, options) -> Result<HarnessCheckResult, HarnessError>` checks one harness key or alias.
- `detect_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>` checks every registry entry.
- `detect_installed_harnesses(options) -> Result<Vec<HarnessCheckResult>, HarnessError>` returns only installed harnesses.

`CheckOptions` accepts optional `env` and `cwd` overrides for path resolution.

`HarnessDefinition` and `HarnessSupportRecord` expose the shared registry's nested support metadata through `HarnessSupport`, `HarnessSupportArea`, `HarnessSupportScope`, and `HarnessSupportPath`.

## Dependencies

The only runtime dependencies are `serde` and `serde_json`. The registry is
embedded at compile time via `include_str!`, so there are no filesystem reads
of the JSON at runtime.

## Development

Run from `packages/rust`:

| Purpose | Command |
|---|---|
| Run tests | `cargo test` |
| Lint | `cargo clippy --all-targets -- -D warnings` |
| Format check | `cargo fmt --check` |
| Format apply | `cargo fmt` |
| Build | `cargo build` |

See [../../docs/maintainers.md](../../docs/maintainers.md) for the full
command reference and registry editing procedure.

## License

[MIT](../../LICENSE)
