# Troubleshooting

Common problems, their causes, and fixes.

## Root-level bun or go commands fail

### Symptom

```sh
$ bun test
error: Could not find package.json
```

or

```sh
$ go test ./...
go: go.mod file not found
```

### Cause

The repo root has no `package.json` and no `go.mod`. All package manifests live
inside `packages/typescript` and `packages/golang`.

### Fix

Always run commands from the package directory:

```sh
cd packages/typescript && bun test
cd packages/golang && go test ./...
```

Or use mise shortcuts from the repo root:

```sh
mise run test
```

## Smoke test fails from the repo root

### Symptom

```sh
$ bun run smoke:fixtures:local
error: Missing script: "smoke:fixtures:local"
```

### Cause

Same as above — the root has no `package.json`.

### Fix

```sh
cd packages/typescript && bun run smoke:fixtures:local
```

## Registry sync test fails

### Symptom

The test `packaged registry stays byte-for-byte synced with the shared registry`
fails, or the Go test `TestEmbeddedDataMatchesSharedFile` fails.

### Cause

You edited `packages/data/harnesses.json` (the canonical registry) but did not
copy the updated file to the package copies.

### Fix

Sync the canonical file to package copies:

```sh
mise run registry:sync
```

Then re-run tests:

```sh
cd packages/typescript && bun test
cd packages/golang && go test ./...
cd packages/rust && cargo test
cd packages/python && uv run pytest
```

Or verify alignment without running tests:

```sh
cmp -s packages/data/harnesses.json packages/typescript/data/harnesses.json && echo "TS OK"
cmp -s packages/data/harnesses.json packages/golang/harnessdetect/data/harnesses.json && echo "Go OK"
```

## A harness is detected as installed when it should not be

### Symptom

`detectHarnesses()` reports a harness as `installed: true` when you do not
expect it to be.

### Likely causes

1. **A config/state path exists on your machine.** Detection is evidence-based:
   if any known path (e.g. `~/.claude/settings.json`) exists, the harness counts
   as installed even without the executable.
2. **An executable with the same name is on your PATH.** For example, a
   different tool named `q` would trigger `amazon-q-cli` detection.
3. **Leftover config directories from a previous install.** Uninstalling a
   harness CLI may not remove its config directory.

### Diagnostic commands

Check which reasons triggered the detection:

> **Privacy:** The `matchedPaths` and `executablePath` output below, along with
> all resolved paths in `paths`, can contain absolute usernames, home
> directories, project paths, executable paths, and harness config/state paths.
> Redact them before sharing logs, telemetry, bug reports, screenshots, or
> analytics.

```js
import { checkHarness } from "@auron-labs/harness-detect";

const result = checkHarness("claude-code");
console.log(result.reasons);
console.log(result.matchedPaths.map((p) => ({ id: p.id, path: p.path })));
console.log(result.executablePath);
```

Check if a specific executable is on your PATH:

```sh
which claude
which codex
```

Check if config directories exist:

```sh
ls -la ~/.claude/
ls -la ~/.codex/
```

### Fix

- Remove leftover config directories if the harness is no longer installed.
- If you need to test detection in isolation, pass a controlled `env` and `cwd`:

```js
checkHarness("claude-code", {
  env: { HOME: "/tmp/empty-home", PATH: "/usr/bin" },
  cwd: "/tmp/empty-project"
});
```

## A harness is not detected when it should be

### Symptom

`detectHarnesses()` reports a harness as `installed: false` when you know it is
installed.

### Likely causes

1. **The executable is not on PATH.** Check with `which <executable>`.
2. **The harness uses a non-standard config location.** If you set an env var
   like `CODEX_HOME` to a custom location, detection should follow it — but if
   the path template doesn't match your layout, it won't be found.
3. **Platform gating.** Some paths are restricted to specific platforms (e.g.
   macOS-only paths are skipped on Linux).
4. **The harness is not in the registry.** Check
   [configuration.md](./configuration.md) for the full list, or:

```js
import { listHarnesses } from "@auron-labs/harness-detect";
console.log(listHarnesses().map((h) => h.key));
```

### Fix

- Ensure the executable is on `PATH`.
- If the harness config is in a non-standard location, check whether the
  registry models that location. If not, consider opening an issue or PR to
  update the registry (see [development.md](./development.md)).

## `checkHarness` throws "Unknown harness"

### Symptom

```
Error: Unknown harness: my-harness
```

### Cause

The input string does not match any harness `key` or `alias` (case-insensitive,
trimmed).

### Fix

Check valid keys and aliases:

```js
import { listHarnesses } from "@auron-labs/harness-detect";

for (const h of listHarnesses()) {
  console.log(h.key, h.aliases);
}
```

## Docker smoke test fails or hangs

### Symptom

`bun run smoke:fixtures` fails, hangs, or cannot pull the `oven/bun:1.3` image.

### Cause

The Docker smoke test runs the local fixture smoke inside a Linux `oven/bun:1.3`
container. It requires Docker to be running and able to pull images.

### Fix

- Ensure Docker is running: `docker info`
- Pull the image manually: `docker pull oven/bun:1.3`
- Use the local smoke test instead (what CI uses):

```sh
cd packages/typescript && bun run smoke:fixtures:local
```

> **Note:** The Docker smoke test has not been confirmed to run successfully in
> all local environments. The local smoke test is verified and is what CI uses.

## Type-check errors after API changes

### Symptom

`bun run types:check` fails after changing the exported API.

### Cause

The TypeScript declarations in `index.d.ts` are out of sync with `src/index.js`.

### Fix

Update `packages/typescript/index.d.ts` to match the new API surface. The
type-check config (`tsconfig.types.json`) compiles `test/types-consumer.ts`
against the declarations.

## Go test fails after registry edit

### Symptom

`go test ./...` fails with `embedded harness data mismatch`.

### Cause

The Go embedded registry copy
(`packages/golang/harnessdetect/data/harnesses.json`) does not match the
canonical `packages/data/harnesses.json`.

### Fix

```sh
mise run registry:sync
cd packages/golang && go test ./...
```

## Rust test fails after registry edit

### Symptom

`cargo test` fails with `embedded_data_matches_shared_file` assertion error.

### Cause

The Rust embedded registry copy (`packages/rust/data/harnesses.json`) does not
match the canonical `packages/data/harnesses.json`.

### Fix

```sh
mise run registry:sync
cd packages/rust && cargo test
```

## Python test fails after registry edit

### Symptom

`uv run pytest` fails with `test_bundled_data_matches_shared_file` assertion
error.

### Cause

The Python bundled registry copy
(`packages/python/src/harness_detect/data/harnesses.json`) does not match the
canonical `packages/data/harnesses.json`.

### Fix

```sh
mise run registry:sync
cd packages/python && uv run pytest
```

## Escalation

For issues not covered here:

- Open a GitHub issue with the package name/version; applicable Node.js, Bun,
  Go, Rust, or Python version; OS/platform; harness key or alias; expected and
  actual results; sanitized `reasons`; and sanitized `matchedPaths` and `paths`
  (resolved-path) summaries. Include environment-root override names and only
  redacted values. See [SUPPORT.md](../SUPPORT.md) for the complete checklist.
- Do **not** include full environment dumps, token or secret values, or
  unredacted absolute paths, usernames, or project names.
- For security issues, follow [SECURITY.md](../SECURITY.md) — do **not** open a
  public issue.
