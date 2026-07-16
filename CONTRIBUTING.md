# Contributing

Thanks for helping improve `harness-detect`.

## What to open

- **Bug report / support question / feature request:** open a GitHub issue first
- **Small doc or test fix:** PRs are fine directly
- **Harness registry change:** open an issue or PR with evidence for every added or changed rule

## Registry changes

The shared registry lives at `packages/data/harnesses.json` and is public API for both implementations.

Follow [docs/harness-guide.md](./docs/harness-guide.md) for the canonical edit/sync/check workflow and [docs/package-guide.md](./docs/package-guide.md) for the cross-package API contract.

When proposing a harness change:

- keep `key` stable and lowercase
- prefer a data-only change over package-specific detection code
- add at least one source URL for each executable/path rule you add or change
- prefer documented config/state/install paths over guesses
- if a path cannot be verified, omit it
- use derived env roots such as `${CODEX_ROOT}` when a harness documents a root override

Required local workflow from the repo root:

- edit `packages/data/harnesses.json`
- run `mise run registry:sync`
- run `mise run registry:check`

CI uses the read-only `mise run registry:check` step to verify package copies remain byte-for-byte aligned; do not hand-edit the generated package copies.

## Pull requests

Keep PRs focused and include:

- a short problem statement
- the reason for any registry additions or edits
- test evidence for the change

## Local verification

For registry-only changes, start from the repo root:

- `mise run registry:sync`
- `mise run registry:check`

From `packages/typescript`:

- `bun test`
- `bun run smoke:fixtures:local` when detection behavior or registry shape changes

From `packages/golang`:

- `go test ./...`

From `packages/rust`:

- `cargo test`

From `packages/python`:

- `uv run pytest`

Cross-package parity is part of the normal contribution path. Keep the shared registry and package copies aligned with `mise run registry:sync`, confirm the read-only drift gate with `mise run registry:check`, and run the relevant package verification that matches the implemented CI scope.
