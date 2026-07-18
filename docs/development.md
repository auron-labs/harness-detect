# Development

## Repository layout

See [architecture.md](./architecture.md) for the full tree. Key directories:

| Path | Contents |
|---|---|
| `packages/data/` | Canonical shared registry |
| `packages/typescript/` | TypeScript package (`@auron-labs/harness-detect`) |
| `packages/golang/` | Go package (`github.com/auron-labs/harness-detect/packages/golang/harnessdetect`) |
| `packages/rust/` | Rust crate (`harness-detect`) |
| `packages/python/` | Python package (`harness-detect`) |
| `docs/` | This documentation |
| `.github/workflows/` | CI pipeline |

## Prerequisites

- Bun 1.3.14 for the TypeScript package
- Go 1.26.4
- Rust stable
- Python >= 3.10 and uv
- Optional: [mise](https://mise.jdx.dev/) for task shortcuts

## Commands

See [maintainers.md](./maintainers.md) for the full command reference,
the registry editing procedure, and change-aware validation.

## Coding conventions

### TypeScript

- ESM only (`"type": "module"` in `package.json`). Use `import`, not `require`.
- Keep the package dependency-free unless the change clearly needs otherwise.
- `src/index.js` should stay generic: compute effective roots, expand
  templates, check executables, return results. No harness-specific code paths.
- If you change the exported API, update `index.d.ts` in the same change.

### Go

- Keep the package dependency-free.
- `harnessdetect.go` should stay generic, same as the TypeScript source.
- Run `go vet ./...` after any Go code change.

### Rust

- Keep the crate dependency-light.
- Run `cargo fmt --check`, `cargo clippy --all-targets`, and `cargo test`
  after Rust code changes.

### Python

- Keep the package dependency-free at runtime.
- Run `uv run ruff check .`, `uv run ruff format --check .`, and
  `uv run pytest` after Python code changes.

## Editing the harness registry

See [maintainers.md](./maintainers.md) for the source-of-truth files,
editing rules, and post-edit verification steps.

When a registry change adds or updates `support` metadata, regenerate
[support-matrix.md](./support-matrix.md) from the updated registry so
contributors can discover the new surface without reading raw JSON.

## Documentation maintenance workflow

1. Put cross-cutting support guidance in `docs/`, not in package READMEs.
2. Run `mise run docs:generate` after registry edits that affect generated docs.
   That task regenerates the env-var table in
   [configuration.md](./configuration.md) and the generated
   [support-matrix.md](./support-matrix.md).
3. For support-only doc regeneration, run
   `mise run docs:support-matrix:generate`.
4. Keep [api.md](./api.md), [configuration.md](./configuration.md),
   [harness-guide.md](./harness-guide.md), and
   [maintainers.md](./maintainers.md) aligned when support semantics or
   workflows change.
5. Run `mise run docs:check` before handoff to verify generated docs are not
   stale.

### Docs scouting and evidence expectations

- Prefer first-party docs before source spelunking.
- Use upstream repositories/source when product docs do not spell out support
  surfaces.
- Use `observed` or `inferred` support confidence sparingly and explain it with
  concise `notes` when needed.
- Keep reviewer-facing evidence in `sources[]`; docs should explain the policy,
  not duplicate every URL.

## Change-aware validation

See [maintainers.md](./maintainers.md) for the change-aware validation
table.

## Contribution workflow

1. Open a GitHub issue first for bug reports, feature requests, or registry
   changes.
2. Small doc or test fixes can go directly as PRs.
3. Registry changes require evidence for every added or changed rule.
4. Keep PRs focused and include:
   - A short problem statement
   - The reason for any registry additions or edits
   - Test evidence for the change

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full details.

## Known pitfalls

- **Root package-manager commands fail.** Always `cd` into the package directory first.
- **Registry sync is manual.** Tests assert byte-for-byte alignment but do not
  auto-sync. Edit `packages/data/harnesses.json`, then run `mise run
  registry:sync` before verification.
- **Docker smoke is unverified locally.** Use `bun run smoke:fixtures:local`
  (what CI runs).
- **Registry is public API.** Raw registry APIs, harness-list APIs, and
  detection results that embed full harness definitions now include optional
  `support` metadata. That metadata is descriptive only and does not change
  installed detection semantics.
- **`support.local` is `${CWD}`-rooted.** Treat local support as
  project/workspace-scoped support, not as another HOME/XDG global surface.
- **Pre-publication compatibility policy.** The repo is still unpublished, so
  prefer a clean aligned API/schema over compatibility-only layers. Keep
  registry `version: 1` unless internal tooling truly requires a bump.
- **ESM only.** Use `import`, not `require`, in the TypeScript package.
