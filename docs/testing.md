# Testing

## Test strategy

Packages use the same testing approach: behavior tests that verify
detection logic, registry integrity, support-metadata parity, and API
correctness. Tests are hermetic — they do not require real harnesses to be
installed.

## Commands

### TypeScript

Run from `packages/typescript`:

| Purpose | Command |
|---|---|
| Unit tests | `bun test` |
| Dependency audit | `bun audit` |
| Type-check | `bun run types:check` |
| Local hermetic smoke test | `bun run smoke:fixtures:local` |
| Docker smoke test | `bun run smoke:fixtures` |

`bun test` runs the test suite with Bun's built-in test runner.

### Go

Run from `packages/golang`:

| Purpose | Command |
|---|---|
| Unit tests | `go test ./...` |
| Vet | `go vet ./...` |
| Vulnerability check | `go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...` |

### Rust

Run from `packages/rust`:

| Purpose | Command |
|---|---|
| Tests | `cargo test` |
| Lint | `cargo clippy --all-targets` |
| Format check | `cargo fmt --check` |
| Dependency audit | `cargo install cargo-audit --locked && cargo audit` |
| Hermetic perf smoke | `cargo run --quiet --release --example perf_smoke` |

### Python

Run from `packages/python`:

| Purpose | Command |
|---|---|
| Install dev deps | `uv sync --dev` |
| Tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format check | `uv run ruff format --check .` |
| Dependency audit | `uv run --with pip-audit pip-audit` |
| Hermetic perf smoke | `uv run python scripts/perf_smoke.py` |

### mise shortcuts (from repo root)

| Purpose | Command |
|---|---|
| Package tests | `mise run test` |
| Local smoke test | `mise run smoke` |
| Regenerate generated docs | `mise run docs:generate` |
| Check generated docs freshness | `mise run docs:check` |
| Package perf reports | `mise run perf` |
| Full release verification | `mise run verify` |

## Pre-publication package validation

These checks validate local package artifacts and an external Go consumer. They
never publish packages or install them from remote registries.

| Distribution | Command | What it validates |
|---|---|---|
| npm | `mise run ts:pack` / `cd packages/typescript && bun pm pack --dry-run` | npm tarball contents. |
| Go module | `mise run go:consumer` | A deterministic temporary consumer module imports the local Go module through a `replace` directive; the temporary module is removed afterward. |
| Rust crate | `mise run rust:package` / `cd packages/rust && cargo package --allow-dirty` | Local crate packaging without publication. |
| Python | `mise run python:build` / `cd packages/python && uv build` | Local wheel and source-distribution builds without publication. |

`mise run verify` runs all of these checks. The Rust and Python build commands
leave their standard local outputs in `packages/rust/target/package/` and
`packages/python/dist/`; no package is uploaded.

## What CI runs

`.github/workflows/ci.yml` runs on every push and pull request, from
package directories via `working-directory`:

1. `bun install --frozen-lockfile` (TypeScript)
2. `bun scripts/sync-registry.mjs --check` (repo root)
3. `node scripts/generate-support-matrix.mjs --check` (repo root)
4. `bunx automd --dir ../..` (TypeScript)
5. `git diff --exit-code -- README.md docs/index.md docs/api.md docs/configuration.md` (repo root)
6. `bun test` (TypeScript)
7. `bun audit` (TypeScript)
8. `bun run types:check` (TypeScript)
9. `bun run smoke:fixtures:local` (TypeScript)
10. `bun pm pack --dry-run` (TypeScript)
11. `bun scripts/check-api-parity.mjs` (repo root)
12. `go test ./...` (Go)
13. `go vet ./...` (Go)
14. `node scripts/check-go-consumer.mjs` (repo root)
15. `go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...` (Go)
16. `cargo fmt --check` (Rust)
17. `cargo clippy --all-targets` (Rust)
18. `cargo test` (Rust)
19. `cargo package --allow-dirty` (Rust)
20. `cargo install cargo-audit --locked && cargo audit` (Rust)
21. `uv sync --dev --frozen` (Python)
22. `bun scripts/check-package-parity.mjs` (repo root)
23. `uv run ruff check .` (Python)
24. `uv run ruff format --check .` (Python)
25. `uv run pytest` (Python)
26. `uv build` (Python)
27. `uv run --with pip-audit pip-audit` (Python)

Locally, `mise run verify` also runs `mise run docs:check` near the start of
the sequence, so generated-doc freshness — including the support matrix — is a
required verification gate before handoff.

## TypeScript tests

Source: `packages/typescript/test/index.test.js`

### Test cases

| Test | What it verifies |
|---|---|
| `matrix is readable` | `getHarnessMatrix()` returns version 1 and >= 10 harnesses |
| `packaged registry stays byte-for-byte synced` | `packages/typescript/data/harnesses.json` matches `packages/data/harnesses.json` byte-for-byte |
| `verified harness additions are present` | Specific harness keys exist in the registry |
| `support APIs expose canonical support metadata and return defensive deep copies` | `getHarnessSupport()` / `listHarnessSupport()` mirror registry `support` data without mutation leaks |
| `checkHarness resolves env overrides` | `CODEX_HOME` override resolves `config` and `project-config` paths correctly |
| `checkHarness resolves harness-specific derived roots` | `HERMES_HOME` override resolves `config` and `sessions` paths via `roots[]` |
| `aliases map to the same harness` | `checkHarness("claude")` and `checkHarness("claude-code")` return the same key |
| `detectHarnesses checks the whole registry` | `detectHarnesses()` returns one result per harness |
| `checkHarness throws for unknown harness` | Unknown key throws `Error: Unknown harness: ...` |
| `unresolved env placeholder yields null path` | `amazon-q-cli`'s `data-root-env` path is null when `Q_CLI_DATA_DIR` is unset |
| `platform-gated entries are included on matching platform` | Cursor's `app-macos` path is present on `darwin` |
| `path-only match makes harness installed` | A config file on disk triggers `installed: true` without an executable |
| `executable match makes harness installed` | An executable on PATH triggers `installed: true` |
| `non-executable PATH file does not make harness installed` | A non-executable file on PATH does not trigger detection (non-Windows) |
| `reasons and matchedPaths are populated` | Both executable and path reasons appear in the result |

### Type-check test

Source: `packages/typescript/test/types-consumer.ts`

This file imports from `@auron-labs/harness-detect` and exercises the type
declarations in `index.d.ts`. It is compiled by `tsc --noEmit` via
`tsconfig.types.json`. Run with:

```sh
cd packages/typescript && bun run types:check
```

## Go tests

Source: `packages/golang/harnessdetect/harnessdetect_test.go`

### Test cases

| Test | What it verifies |
|---|---|
| `TestEmbeddedDataMatchesSharedFile` | Embedded `harnesses.json` matches `packages/data/harnesses.json` byte-for-byte |
| `TestGetHarnessMatrix` | `GetHarnessMatrix()` returns version 1 and >= 10 harnesses |
| `TestListHarnesses` | `ListHarnesses()` length matches `GetHarnessMatrix().Harnesses` |
| `TestSupportAPIs` | `GetHarnessSupport()` / `ListHarnessSupport()` mirror registry `support` data and deep-copy it |
| `TestCheckHarness_ResolvesEnvOverrides` | `CODEX_HOME` override resolves paths correctly |
| `TestCheckHarness_ResolvesDerivedRoots` | `HERMES_HOME` override resolves paths via `roots[]` |
| `TestCheckHarness_AliasesMatch` | Alias and key resolve to the same harness |
| `TestDetectHarnesses_ChecksAll` | `DetectHarnesses()` returns one result per harness |
| `TestCheckHarness_Unknown` | Unknown key returns error `Unknown harness: ...` |
| `TestCheckHarness_UnresolvedPlaceholder` | Unresolved placeholder yields a nullable path (`nil` in Go / JSON `null`) and `exists = false` |
| `TestCheckHarness_PlatformGated` | Platform-gated paths are included on matching platform (darwin only) |
| `TestCheckHarness_PathMatchInstalls` | Path existence triggers `installed: true` |
| `TestCheckHarness_ExecutableMatchInstalls` | Executable on PATH triggers `installed: true` |
| `TestCheckHarness_NonExecutableDoesNotMatch` | Non-executable file does not trigger detection (non-Windows) |
| `TestCheckHarness_ReasonsAndMatchedPaths` | Both executable and path reasons appear |

## Rust tests

Source: `packages/rust/tests/behavior.rs` (integration tests), `packages/rust/src/lib.rs` (unit tests)

### Test cases

| Test | What it verifies |
|---|---|
| `embedded_data_matches_shared_file` | Embedded `harnesses.json` matches `packages/data/harnesses.json` byte-for-byte |
| `test_get_harness_matrix` | `get_harness_matrix()` returns version 1 and >= 10 harnesses |
| `test_list_harnesses` | `list_harnesses()` length matches `get_harness_matrix().harnesses` |
| `test_support_api_matches_matrix_shape` | `get_harness_support()` / `list_harness_support()` mirror registry `support` data |
| `test_support_api_returns_cloned_data` | Support APIs return defensive deep clones |
| `test_get_harness_support_unknown` | Unknown key returns `HarnessError` |
| `test_check_harness_resolves_env_overrides` | `CODEX_HOME` override resolves paths correctly |
| `test_check_harness_ignores_env_cwd_when_option_unset` | `CWD` env var is not read when `cwd` option is unset |
| `test_check_harness_resolves_derived_roots` | `HERMES_HOME` override resolves paths via `roots[]` |
| `test_check_harness_aliases_match` | Alias and key resolve to the same harness |
| `test_detect_harnesses_checks_all` | `detect_harnesses()` returns one result per harness |
| `test_detect_installed_harnesses_only_installed` | `detect_installed_harnesses()` returns only installed results |
| `test_check_harness_unknown` | Unknown key returns `HarnessError("Unknown harness: ...")` |
| `test_check_harness_unresolved_placeholder` | Unresolved placeholder yields `None` path and `exists = false` |
| `test_check_harness_platform_gated` | Platform-gated paths are included on matching platform |
| `test_check_harness_path_match_installs` | Path existence triggers `installed: true` |
| `test_check_harness_executable_match_installs` | Executable on PATH triggers `installed: true` |
| `test_check_harness_non_executable_does_not_match` | Non-executable file does not trigger detection (non-Windows) |
| `test_check_harness_reasons_and_matched_paths` | Both executable and path reasons appear |
| `test_find_executable_windows_exe` | Windows `.exe` extension lookup works |
| `test_find_executable_windows_bat` | Windows `.bat` extension lookup works |
| `test_find_executable_windows_no_match` | Windows executable lookup returns none when no match |
| `test_registry_validates_against_schema` | Registry validates against `harnesses.schema.json` |

## Python tests

Source: `packages/python/tests/test_behavior.py`

### Test cases

| Test | What it verifies |
|---|---|
| `test_bundled_data_matches_shared_file` | Bundled `harnesses.json` matches `packages/data/harnesses.json` byte-for-byte |
| `test_get_harness_matrix` | `get_harness_matrix()` returns version 1 and >= 10 harnesses |
| `test_list_harnesses` | `list_harnesses()` length matches `get_harness_matrix().harnesses` |
| `test_support_api_matches_matrix_shape` | `get_harness_support()` / `list_harness_support()` mirror registry `support` data |
| `test_support_api_is_immutable` | Support APIs return defensive deep clones |
| `test_harness_definition_exposes_support_and_installations` | `HarnessDefinition` exposes `support` and `installations` |
| `test_check_harness_resolves_env_overrides` | `CODEX_HOME` override resolves paths correctly |
| `test_check_harness_ignores_env_cwd_when_option_unset` | `CWD` env var is not read when `cwd` option is unset |
| `test_check_harness_resolves_derived_roots` | `HERMES_HOME` override resolves paths via `roots[]` |
| `test_check_harness_aliases_match` | Alias and key resolve to the same harness |
| `test_detect_harnesses_checks_all` | `detect_harnesses()` returns one result per harness |
| `test_detect_installed_harnesses_only_installed` | `detect_installed_harnesses()` returns only installed results |
| `test_check_harness_unknown` | Unknown key raises `HarnessError("Unknown harness: ...")` |
| `test_get_harness_support_unknown` | Unknown key raises `HarnessError` from `get_harness_support()` |
| `test_check_harness_unresolved_placeholder` | Unresolved placeholder yields `None` path and `exists = false` |
| `test_check_harness_platform_gated` | Platform-gated paths are included on matching platform |
| `test_check_harness_path_match_installs` | Path existence triggers `installed: true` |
| `test_check_harness_executable_match_installs` | Executable on PATH triggers `installed: true` |
| `test_check_harness_non_executable_does_not_match` | Non-executable file does not trigger detection (non-Windows) |
| `test_check_harness_reasons_and_matched_paths` | Both executable and path reasons appear |
| `test_find_executable_windows_exe` | Windows `.exe` extension lookup works |
| `test_find_executable_windows_bat` | Windows `.bat` extension lookup works |
| `test_find_executable_windows_no_match` | Windows executable lookup returns none when no match |
| `test_registry_validates_against_schema` | Registry validates against `harnesses.schema.json` |
| `test_resolve_template_unresolved_returns_none` | Unresolved template returns `None` |

## Smoke tests

Source: `packages/typescript/scripts/smoke-fixtures.js`

The smoke test is a hermetic, end-to-end fixture test. It:

1. Creates a temp directory with a fake `HOME`, `CWD`, `bin` (PATH), and XDG
   directories.
2. Sets env overrides for harnesses that support them (e.g. `CODEX_HOME`,
   `CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, etc.).
3. For each harness in the registry:
   - Verifies it starts as **not installed** in the isolated environment.
   - Creates a fake executable and/or fake config/state path.
   - Verifies the harness becomes **installed** after fixture setup.
4. Prints a JSON summary: `{ platform, exercisedCount, skippedCount, exercised, skipped }`.

### Local smoke test

```sh
cd packages/typescript && bun run smoke:fixtures:local
```

- **Prerequisites:** Node.js 18+ and installed package dependencies.
- **CI behavior:** This is the smoke path CI runs.
- **Expected output:** Exit 0 and a JSON summary.
- **What it proves:** Hermetic fixture detection works. It does **not** install
  real harnesses.

### Docker smoke test

```sh
cd packages/typescript && bun run smoke:fixtures
```

- **Prerequisites:** Docker running locally; may pull `oven/bun:1.3`.
- **Expected output:** Exit 0 and the same JSON summary shape.
- **What it proves:** The same fixture smoke inside Linux/Docker.
- **Note:** This path has not been confirmed to run successfully in all local
  environments. Use the local smoke test for routine verification.

### Skipped harnesses

Some harnesses may be skipped in the smoke test if they have no fixtureable
path or executable on the current platform. The `skipped` array in the JSON
output explains why each was skipped.

## How to add tests

### TypeScript

Add a new test case to `packages/typescript/test/index.test.js` using Bun's
built-in test runner (which supports `node:test` APIs):

```js
test("my new test", () => {
  const result = checkHarness("codex", {
    env: { HOME: "/tmp/test", PATH: "" },
    cwd: "/repo"
  });
  assert.equal(result.key, "codex");
});
```

### Go

Add a new test function to
`packages/golang/harnessdetect/harnessdetect_test.go`:

```go
func TestMyNewTest(t *testing.T) {
    result, err := CheckHarness("codex", CheckOptions{
        Env: map[string]string{"HOME": "/tmp/test", "PATH": ""},
        CWD: "/repo",
    })
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if result.Key != "codex" {
        t.Fatalf("expected codex, got %s", result.Key)
    }
}
```

### Rust

Add a new test function to `packages/rust/tests/behavior.rs`:

```rust
#[test]
fn test_my_new_test() {
    let mut env = std::collections::HashMap::new();
    env.insert("HOME".to_string(), "/tmp/test".to_string());
    env.insert("PATH".to_string(), "".to_string());

    let result = check_harness("codex", CheckOptions {
        env: Some(env),
        cwd: Some("/repo".to_string()),
    }).unwrap();

    assert_eq!(result.key, "codex");
}
```

### Python

Add a new test function to `packages/python/tests/test_behavior.py`:

```python
def test_my_new_test():
    result = check_harness("codex", CheckOptions(
        env={"HOME": "/tmp/test", "PATH": ""},
        cwd="/repo",
    ))
    assert result.key == "codex"
```

## Registry sync tests

Every package with a bundled/embedded registry copy includes a test that
verifies that copy matches the canonical `packages/data/harnesses.json`
byte-for-byte:

- TypeScript: `packaged registry stays byte-for-byte synced with the shared
  registry`
- Go: `TestEmbeddedDataMatchesSharedFile`
- Rust: `embedded_data_matches_shared_file`
- Python: `test_bundled_data_matches_shared_file`

These tests fail if you edit the canonical registry without syncing it to all
package copies. See [troubleshooting.md](./troubleshooting.md) for the fix.

Support metadata does not change the detection contract under test: installed
status still comes only from executable matches and existing `paths[]` entries.

## Documentation verification

- `mise run docs:generate` regenerates the env-var table in
  `docs/configuration.md`, the generated `docs/support-matrix.md`, and Automd
  repository stats.
- `mise run docs:support-matrix:generate` regenerates only the support matrix.
- `mise run docs:check` runs the stale checks for all generated docs and stats.
- The TypeScript test suite checks that generated table stays in sync with the
  registry.
- `mise run docs:support-matrix:check` verifies the matrix still matches
  registry `support` data.
