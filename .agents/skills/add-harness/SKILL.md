---
name: add-harness
description: Add a new LLM harness to the harness-detect monorepo, or update and re-verify an existing one, including evidence-backed detection rules, the verified upstream version, installation, support, .agents/skills, ACP, and MCP metadata, registry synchronization, and cross-package validation. Use when adding detection for a CLI, editor, or agent product, refreshing an entry against new upstream releases, or extending an existing harness entry. Does not cover adding a new language package or building a harness itself.
---

# Add or update a harness

Implement harness support through the shared registry whenever the existing schema can express it. Detection uses executable matches or existing resolved `paths[]`; `version`, `installations`, `support`, `acp`, and `mcp` are descriptive metadata only.

When updating an existing entry, treat it as a re-verification: check every field against current upstream docs/source, correct what is contradicted, fill gaps you can evidence, and bump `version` to the release you checked. Keep keys, aliases, path `id`s, and root names stable because tests and consumers reference them.

## Read the repository contract

Work from the `harness-detect` repository root. Paths in commands and inline code below are relative to that root.

- Read [AGENTS.md](../../../AGENTS.md), the [harness guide](../../../docs/harness-guide.md), and the registry editing and change-aware validation sections of [maintainers.md](../../../docs/maintainers.md).
- Inspect [the schema](../../../packages/data/harnesses.schema.json) and a comparable entry in [the canonical registry](../../../packages/data/harnesses.json). Use a real entry for structure, but verify the new harness's facts independently.
- Search existing keys, names, and aliases before adding an entry. Extend an existing entry if the requested product is already represented. Keep existing keys stable and avoid collisions after trimming and case normalization.
- Read the relevant `packages/*/AGENTS.md` before editing package files. Consult [the parity contract](../../../docs/package-guide.md) if behavior or schema changes are necessary.

## Establish evidence

Research current first-party documentation and upstream source for executable names, config/state/install paths, root override variables, installation methods, and platform restrictions. Attach exact HTTPS evidence URLs in the harness's `sources` for each detection rule; a product homepage alone is insufficient when it does not substantiate the rule. Omit unverifiable paths and variables.

For each support category, investigate global and local/project behavior separately. Record evidence on the corresponding `support` leaf. Absence from documentation means `unknown`; use `unsupported` only when evidence supports that conclusion. Leave unresolved support surfaces explicit instead of delaying an otherwise well-supported detection entry.

Record the latest released upstream version you verified against in `version` (package registry or GitHub release, no leading `v`; `unknown` only when nothing is published). Prefer `npm view`, PyPI JSON, crates.io, or `gh release list` over memory.

Distinguish evidence that a product reads a shared file from evidence that it is installed. A generic `AGENTS.md`, `.mcp.json`, `.agents/skills`, `.claude/skills`, or parent config directory can be shared by many products. Do not promote shared paths into detection `paths`; keep them in `support` or `mcp` metadata. Assess false positives before adding any path to `paths`. Require at least one verified executable or usable detection path for a new detection entry. If neither can be established, report the evidence gap.

## Find and research ACP records

Read [the ACP lookup workflow](../../../docs/harness-guide.md#finding-and-updating-acp-records).
The canonical record is the harness's top-level `acp`, separate from `support`.
Package consumers use `getHarnessAcp` / `listHarnessAcp` (TypeScript),
`GetHarnessACP` / `ListHarnessACP` (Go), or `get_harness_acp` /
`list_harness_acp` (Rust/Python). These return all registered records, including
adapters and unknowns; missing metadata becomes `unknown` in dedicated getters.

Check `status`. A supported record has either `launches` or one exact `adapter`
registry key. Follow that key once; the target owns the launch list. Select the
launch matching the caller's platform and read both records' `acp.notes` plus
the owner's `installations` and `env` before describing how to run it. Commands
and argv are literal; the library does not execute them or expand placeholders.

Verify agent/server-side ACP, not merely client integration, MCP, an RFC, or a
similarly named product. Cite upstream documentation, source, or distribution
manifests in `acp.sources` with appropriate `confidence`. Record requirements
such as optional dependencies, bundled versus separate CLIs, authentication,
working directories, and architecture limits in notes. Keep absent evidence
`unknown`; only mark `unsupported` with evidence.

Add a separate adapter entry for a verified adapter launch. Use its own
executable for detection, never the host CLI or a generic runtime such as
`node` or `npx`. Exception to the detection-entry rule above: a documented ACP
launch record can have empty `executables` and `paths` when there is no portable,
unambiguous signal, provided `acp.notes` explains the setup limitation. This is
how the source-only `aider-acp` record is represented. Such records remain
discoverable through ACP APIs but never count as installed from metadata.

## Research `.agents/skills` and MCP

`support.agentsSkills` answers exactly one question per scope: does the harness discover Agent Skills (folders with `SKILL.md`) from the shared `.agents/skills` directory **by default**? Supported leaves list `{"id": "global-agents-skills", "kind": "dir", "template": "${HOME}/.agents/skills"}` (global) or `{"id": "project-agents-skills", "kind": "dir", "template": "${CWD}/.agents/skills"}` (local); the validator enforces this. Vendor directories such as `.claude/skills` belong in `support.skills`. Opt-in discovery (a setting that defaults off) is `unsupported` with a note.

Read [the MCP workflow](../../../docs/harness-guide.md#finding-and-updating-mcp-records) and [MCP fields](../../../docs/configuration.md#mcp-metadata-mcp). Every entry has explicit `mcp` metadata:

- `status`: can the harness use MCP servers at all.
- `mcpJson`: does it read the project-root `${CWD}/.mcp.json` by default. A vendor file such as `.cursor/mcp.json` does not count.
- `global` / `local`: the native files that store MCP servers, with `format` (`json`, `jsonc`, `toml`, `yaml`) and `keyPath` (for example `["mcpServers"]`, `["mcp_servers"]`, `["mcp", "servers"]`, or the literal key `["amp.mcpServers"]`). All paths in one scope share format and key path. UI- or database-managed servers are `supported` with empty `paths`.
- `serverFormat`: the native shape of one server entry, copied from the docs' own stdio and remote examples: `container` (`map` or `array` + `nameField`), optional `typeField`, `stdio` `{type?, command, args?, env?}` (omit `args` for argv-array commands), `http`/`sse` `{type?, url, headers?}` (omit transports the harness cannot use), and `defaults` only for fields the harness requires.

Check the result with `translateMcpJson` from `packages/typescript/src/index.js` on a small `.mcp.json` and compare it with the docs' example. ACP adapter records normally keep MCP `unknown`, because ACP clients pass MCP servers per session. The `.mcp.json` translator is generic in every package, so a new harness should need no code; if the docs show a shape `serverFormat` cannot express, extend the schema and all four translators together and add parity cases.

## Author the canonical entry

Edit only `packages/data/harnesses.json`; generate all four package copies later. Preserve surrounding formatting and keep registry `version: 1` for a normal harness addition.

- Include `key`, `name`, `version`, `aliases`, `executables`, `paths`, `env`, `sources`, `installations`, `support`, `mcp`, and explicit `acp` metadata. Use `acp: {"status":"unknown","sources":[],"confidence":"unknown"}` when unverified. An unverified `mcp` is `{"status":"unknown","mcpJson":"unknown","global":<unknown leaf>,"local":<unknown leaf>,"sources":[],"confidence":"unknown"}`. Optional `roots` models derived locations. `aliases`, `executables`, `paths`, and `env` may be empty arrays; `sources` and `installations` each require at least one entry.
- Choose a unique key matching `^[a-z][a-z0-9-]*$`. Use documented executable basenames and aliases that identify this product unambiguously.
- Each detection path needs `id`, `category`, `kind`, and `template`. Categories are `install`, `config`, `state`, `cache`, or `project`; kinds are `file` or `dir`. Use distinct path IDs within the harness.
- Use supported `${UPPERCASE_VARIABLE}` templates. Anchor project paths at `${CWD}`; runtime `cwd` comes from the caller or process, not an environment variable. Check current resolver defaults before assuming a placeholder is populated. Unresolved placeholders produce null paths.
- For a documented root override, define `roots[]` with `name`, `env`, and `fallback`, then reference the derived root in affected paths. Use `use` when the override needs transformation. Keep `env[]` descriptions aligned and preserve both override and fallback behavior.
- Add `platforms` only for evidenced restrictions, using schema values such as `darwin`, `linux`, and `win32`. Do not infer OS parity or invent platform gating fields on executables; check the resolver's executable behavior.
- Record documented installation methods without running installers. The schema requires an HTTPS evidence `url` for each installation. For an underspecified method, use `method: "unknown"` with an upstream URL and factual `notes`, rather than guessing a package name, command, or marketplace ID.

Populate all ten support leaves: `config`, `skills`, `commands`, `agents`, and `agentsSkills`, each with `global` and `local`. Each leaf needs `status`, `paths`, `sources`, and `confidence`; `notes` is optional. Use confidence `official` for explicit first-party documentation, `source` for upstream implementation, `observed` for reproduced behavior, or `inferred` sparingly for reasoned evidence. An unverified leaf is:

```json
{ "status": "unknown", "paths": [], "sources": [], "confidence": "unknown" }
```

Support paths use `id`, `kind`, and `template`, with optional `platforms` and `description`; they do not have a detection `category`. Anchor local/project support at `${CWD}` and apply documented root overrides to global support paths. Attach supporting URLs and a non-unknown confidence to established support claims.

For supported ACP, use a nonempty `launches` list of `{command, args, platforms?}`
or an `adapter` key pointing directly to another supported launch record. Multiple
launches require explicit, non-overlapping platforms. Unknown/unsupported records
have neither launches nor an adapter. Do not turn a version-pinned example into
an inferred minimum version or use a local-path placeholder as executable argv.

If the current schema cannot model verified behavior, explain the limitation and make the smallest shared extension needed for the requested harness. Update the schema, all affected implementations/types, and parity fixtures together; avoid a harness-specific branch in one language. Keep version 1 unless tooling actually requires a document-version change.

## Cover behavior and refresh generated files

For a new entry, use `mise run harness:new -- <key> "<name>" [--alias <alias>]` to print an incomplete JSON draft without editing the registry. Fill in verified detection signals, sources, installations, `version`, and `mcp` before inserting it into the canonical registry. All ten support leaves and the MCP block start as `unknown`. The command rejects collisions with existing keys and aliases.

Check existing coverage before adding tests. The shared Ajv validator checks the schema and semantic invariants, and the local smoke runner exercises each executable and fixtureable path separately in a fresh temporary tree. Extend [shared parity fixtures](../../../testdata/package-parity-cases.json) when the new entry introduces behavior those checks do not exercise: alias lookup, root overrides and fallbacks, project paths, or platform restrictions. Include explicit `expect` results so agreement between packages is also checked against intended behavior. The `translate-probe-every-harness` case already runs every harness's `serverFormat` through all four packages. If you add or change a public function, add a parity case for it: `scripts/check-package-parity.mjs` fails when a function in `testdata/public-api-parity.json` has no case, and raw-registry cases must reproduce the canonical registry in every package. Reuse existing fixture conventions and isolate `HOME`, `PATH`, and `cwd` in temporary directories.

Run from the repository root after editing:

```sh
mise run harness:refresh
```

Refresh validates the canonical registry, syncs the TypeScript, Go, Rust, and Python copies, and generates the support matrix, environment-variable table, and repository statistics. Review those outputs and update affected explanatory docs. Do not hand-edit generated copies, tables, or counts.

## Validate and hand off

Use the current commands in `mise.toml` and `docs/maintainers.md`. For a new harness entry, run from the repository root:

```sh
mise run harness:check
```

Add package-specific lint/format checks when changing implementation code; `mise run verify` is the broader release check. Prefer the local hermetic smoke task; Docker smoke is unverified locally. Package-native commands must run in their package directories because the root has no package manifests.

`harness:check` covers schema/semantic validation, registry and docs freshness, all package tests, TypeScript types and smoke, Go vet, API/package parity, and a registry summary. The docs checks are read-only and compare generated content with working files, so correctly refreshed uncommitted changes pass. For a quick structural check use `mise run registry:validate`. For committed branch changes use `mise run harness:summary -- --base <git-ref>`; the default summary compares working files with `HEAD`. CI publishes the PR-base summary in the job summary.

Review the final diff for unrelated changes, missing evidence, and generated drift. Report the added or updated key and aliases, the verified `version`, detection signals, verified platforms and overrides, `.agents/skills` and MCP findings, remaining support unknowns, and checks run with their outcomes. Call out skipped platform coverage or unavailable tools without claiming they passed.
