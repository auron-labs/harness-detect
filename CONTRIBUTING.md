# Contributing

Thanks for helping improve `harness-detect`.

## What to open

- **Bug report / support question / feature request:** open a GitHub issue first
- **Small doc or test fix:** PRs are fine directly
- **Harness registry change:** open an issue or PR with evidence for every added or changed rule

## Registry changes

The shared registry lives at `packages/data/harnesses.json` and is public API for all four packages.

Follow [docs/harness-guide.md](./docs/harness-guide.md) for the canonical edit/sync/check workflow and [docs/package-guide.md](./docs/package-guide.md) for the cross-package API contract.

When proposing a harness change:

- keep `key` stable and lowercase
- prefer a data-only change over package-specific detection code
- add at least one source URL for each executable/path rule you add or change
- prefer documented config/state/install paths over guesses
- if a path cannot be verified, omit it
- use derived env roots such as `${CODEX_ROOT}` when a harness documents a root override

For a new entry, generate a draft with `mise run harness:new -- example-harness "Example Harness" --alias example-alias`. It prints JSON without editing the registry. Add verified detection signals, evidence URLs, and installation metadata; all support leaves start as `unknown`.

After editing only `packages/data/harnesses.json`, run from the repository root:

```sh
mise run harness:refresh
mise run harness:check
```

Refresh validates the canonical JSON, syncs all package copies, and generates docs. Check verifies schema and semantic rules, generated-file freshness, all package tests, types, smoke, vet, and parity, then prints the registry changes. Do not hand-edit generated package copies. See the [maintainer reference](./docs/maintainers.md#after-editing-the-registry) for individual commands and summary options.

## Pull requests

Keep PRs focused and include:

- a short problem statement
- the reason for any registry additions or edits
- test evidence for the change

## Local verification

Use `mise run harness:check` for registry changes and `mise run verify` for the broader release checks, including packaging and dependency audits. Install TypeScript dev dependencies with `cd packages/typescript && bun install --frozen-lockfile` first. The schema validator uses development-only Ajv; the published detection package remains runtime dependency-free.

For implementation changes, use the package-specific checks in [docs/maintainers.md](./docs/maintainers.md#change-aware-validation).
