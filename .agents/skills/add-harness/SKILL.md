---
name: add-harness
description: Add a new LLM harness to the harness-detect monorepo, including evidence-backed detection rules, installation and support metadata, registry synchronization, and cross-package validation. Use when adding detection for a CLI, editor, or agent product, or extending an existing harness entry. Does not cover adding a new language package or building a harness itself.
---

# Add a harness

Implement harness support through the shared registry whenever the existing schema can express it. Detection uses executable matches or existing resolved `paths[]`; `installations` and `support` are descriptive metadata only.

## Read the repository contract

Work from the `harness-detect` repository root. Paths in commands and inline code below are relative to that root.

- Read [AGENTS.md](../../../AGENTS.md), the [harness guide](../../../docs/harness-guide.md), and the registry editing and change-aware validation sections of [maintainers.md](../../../docs/maintainers.md).
- Inspect [the schema](../../../packages/data/harnesses.schema.json) and a comparable entry in [the canonical registry](../../../packages/data/harnesses.json). Use a real entry for structure, but verify the new harness's facts independently.
- Search existing keys, names, and aliases before adding an entry. Extend an existing entry if the requested product is already represented. Keep existing keys stable and avoid collisions after trimming and case normalization.
- Read the relevant `packages/*/AGENTS.md` before editing package files. Consult [the parity contract](../../../docs/package-guide.md) if behavior or schema changes are necessary.

## Establish evidence

Research current first-party documentation and upstream source for executable names, config/state/install paths, root override variables, installation methods, and platform restrictions. Attach exact HTTPS evidence URLs in the harness's `sources` for each detection rule; a product homepage alone is insufficient when it does not substantiate the rule. Omit unverifiable paths and variables.

For each support category, investigate global and local/project behavior separately. Record evidence on the corresponding `support` leaf. Absence from documentation means `unknown`; use `unsupported` only when evidence supports that conclusion. Leave unresolved support surfaces explicit instead of delaying an otherwise well-supported detection entry.

Distinguish evidence that a product reads a shared file from evidence that it is installed. A generic `AGENTS.md`, `.agents/skills`, or parent config directory can be shared by many products. Do not automatically promote every supported path into an installation signal; assess false positives before adding it to `paths`. Require at least one verified executable or usable detection path for a new detection entry. If neither can be established, report the evidence gap.

## Author the canonical entry

Edit only `packages/data/harnesses.json`; generate all four package copies later. Preserve surrounding formatting and keep registry `version: 1` for a normal harness addition.

- Include `key`, `name`, `aliases`, `executables`, `paths`, `env`, `sources`, `installations`, and `support`. Optional `roots` models derived locations. `aliases`, `executables`, `paths`, and `env` may be empty arrays; `sources` and `installations` each require at least one entry.
- Choose a unique key matching `^[a-z][a-z0-9-]*$`. Use documented executable basenames and aliases that identify this product unambiguously.
- Each detection path needs `id`, `category`, `kind`, and `template`. Categories are `install`, `config`, `state`, `cache`, or `project`; kinds are `file` or `dir`. Use distinct path IDs within the harness.
- Use supported `${UPPERCASE_VARIABLE}` templates. Anchor project paths at `${CWD}`; runtime `cwd` comes from the caller or process, not an environment variable. Check current resolver defaults before assuming a placeholder is populated. Unresolved placeholders produce null paths.
- For a documented root override, define `roots[]` with `name`, `env`, and `fallback`, then reference the derived root in affected paths. Use `use` when the override needs transformation. Keep `env[]` descriptions aligned and preserve both override and fallback behavior.
- Add `platforms` only for evidenced restrictions, using schema values such as `darwin`, `linux`, and `win32`. Do not infer OS parity or invent platform gating fields on executables; check the resolver's executable behavior.
- Record documented installation methods without running installers. Include an evidence `url` for each installation: current package tests require it even though the JSON schema marks it optional. For an underspecified method, use `method: "unknown"` with an upstream URL and factual `notes`, rather than guessing a package name, command, or marketplace ID.

Populate all ten support leaves: `config`, `skills`, `commands`, `agents`, and `dotAgents`, each with `global` and `local`. Each leaf needs `status`, `paths`, `sources`, and `confidence`; `notes` is optional. Use confidence `official` for explicit first-party documentation, `source` for upstream implementation, `observed` for reproduced behavior, or `inferred` sparingly for reasoned evidence. An unverified leaf is:

```json
{ "status": "unknown", "paths": [], "sources": [], "confidence": "unknown" }
```

Support paths use `id`, `kind`, and `template`, with optional `platforms` and `description`; they do not have a detection `category`. Anchor local/project support at `${CWD}` and apply documented root overrides to global support paths. Attach supporting URLs and a non-unknown confidence to established support claims.

If the current schema cannot model verified behavior, explain the limitation and make the smallest shared extension needed for the requested harness. Update the schema, all affected implementations/types, and parity fixtures together; avoid a harness-specific branch in one language. Keep version 1 unless tooling actually requires a document-version change.

## Cover behavior and refresh generated files

Check existing coverage before adding tests. The TypeScript registry tests check entry structure, and the local smoke runner enumerates all harnesses. Extend [shared parity fixtures](../../../testdata/package-parity-cases.json) when the new entry introduces behavior those checks do not exercise: alias lookup, path-only or executable-only detection, root overrides and fallbacks, project paths, or platform restrictions. Include explicit `expect` results so agreement between packages is also checked against intended behavior. Reuse existing fixture conventions and isolate `HOME`, `PATH`, and `cwd` in temporary directories.

Run from the repository root after editing:

```sh
mise run registry:sync
mise run registry:check
mise run docs:generate
```

Sync updates the TypeScript, Go, Rust, and Python registry copies. Docs generation updates the support matrix, environment-variable table, and repository statistics. Review those outputs and update affected explanatory docs. Do not hand-edit generated copies, tables, or counts.

## Validate and hand off

Use the current commands in `mise.toml` and `docs/maintainers.md`. For a new harness entry, run from the repository root:

```sh
mise run ts:test
mise run ts:types
mise run ts:smoke
mise run go:test
mise run go:vet
mise run rust:test
mise run python:test
mise run parity:check
mise run api:check
mise run registry:check
mise run docs:check
```

Add package-specific lint/format checks when changing implementation code; `mise run verify` is the broader release check. Prefer the local hermetic smoke task; Docker smoke is unverified locally. Package-native commands must run in their package directories because the root has no package manifests.

`docs:stats:check` (included in `docs:check`) regenerates content and compares it with Git, so intended, uncommitted generated changes can produce a nonzero exit. Inspect the diff and confirm regeneration leaves the working files unchanged before attributing that result to intended edits. Do not stage or commit merely to make the check pass, and report its actual outcome.

Review the final diff for unrelated changes, missing evidence, and generated drift. Report the added key and aliases, detection signals, verified platforms and overrides, remaining support unknowns, and checks run with their outcomes. Call out skipped platform coverage or unavailable tools without claiming they passed.
