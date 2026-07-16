# Harness registry guide

Agent-facing instructions for adding or editing harnesses in `harness-detect`.
For the user-facing documentation map, start at `docs/index.md`. Keep
`docs/configuration.md`, `docs/testing.md`, `docs/troubleshooting.md`, and
`docs/maintainers.md` aligned when a registry change affects documented counts,
commands, schema behavior, validation, or troubleshooting guidance.

## 1. Canonical file first

The canonical registry is:

- `packages/data/harnesses.json`

The package copies are derived outputs that must stay byte-for-byte aligned with
the canonical registry:

- `packages/typescript/data/harnesses.json`
- `packages/golang/harnessdetect/data/harnesses.json`
- `packages/rust/data/harnesses.json`
- `packages/python/src/harness_detect/data/harnesses.json`

**Edit only `packages/data/harnesses.json`.** Do not make semantic changes in a
package copy. Use the documented sync/copy workflow to refresh derived copies;
CI runs the read-only drift check before pack.

## 2. Required edit flow

From the repo root:

1. Edit `packages/data/harnesses.json`.
2. Sync the generated copies:

   ```sh
   mise run registry:sync
   ```

3. Verify the copies are still byte-for-byte aligned:

   ```sh
   mise run registry:check
   ```

4. Run the required cross-package checks:

   ```sh
   mise run parity:check
   mise run api:check
   mise run ts:test
   mise run ts:types
   mise run ts:smoke
   mise run go:test
   mise run go:vet
   ```

If you want the broader local release check, run `mise run verify`.

If your change affects docs-generated content, also run:

```sh
mise run docs:generate
```

If you only changed registry `support` metadata and want the narrower generated
doc task, run `mise run docs:support-matrix:generate`, then verify freshness
with `mise run docs:check`.

## 3. Evidence requirements

Every added or changed detection rule needs source evidence.

- Add at least one URL in `sources` for every executable, path, root override, or platform-specific rule you add or change.
- Prefer first-party docs, official repos, or vendor docs over blog posts.
- Prefer documented config/state/install paths over guesses.
- If a path cannot be verified, omit it.
- Keep evidence current enough that a reviewer can trace each rule back to a source.

For `support` metadata, gather evidence per surface and per scope:

- Check first-party docs for documented global config, local project files,
  skills/prompts, commands, agents, and `.agents` support.
- Use registry `support.*.*` leaves as the scouting source of truth: after
  verifying official docs or upstream source, update that leaf's `status`,
  `paths`, `sources`, `confidence`, and optional `notes` directly in
  `packages/data/harnesses.json`.
- Land support scouting incrementally when needed: prioritize the highest-use
  harnesses first, improve evidence quality in place, and leave the remaining
  unknowns explicit instead of blocking on full-matrix completion.
- If docs are incomplete, use upstream repository/source evidence before using
  `observed` or `inferred` confidence.
- Record support paths separately for `global` and `local`; do not collapse a
  `${HOME}` path and a `${CWD}` path into one mixed leaf.
- Treat `local` as workspace/project support rooted at `${CWD}`.
- Regenerate [docs/support-matrix.md](./support-matrix.md) when the support
  story materially changes; it is generated from registry `support` data rather
  than maintained by hand.
- Track scouting progress from the generated matrix output itself: count the
  remaining `unknown` leaves from
  `node scripts/generate-support-matrix.mjs --summary` (or the totals printed
  at the top of `docs/support-matrix.md`) instead of maintaining a separate
  checklist.

## 4. Entry checklist

Each harness entry must keep the schema shape expected by every package
implementation.

Required fields on every harness entry:

- `key`
- `name`
- `aliases`
- `executables`
- `paths`
- `env`
- `sources`
- `installations`
- `support`

Optional but supported when needed:

- `roots`

Checklist:

- `key` stays stable, lowercase, and hyphenated as needed. **Never rename an existing key.**
- `aliases`, `executables`, `paths`, and `env` must still exist even when empty.
- `installations` must still exist even when the metadata is minimal.
- Each `paths[]` item must include `id`, `category`, `kind`, and `template`.
- Use `category` values that match the schema: `install`, `config`, `state`, `cache`, `project`.
- Use `kind` values that match the schema: `file` or `dir`.
- Add `platforms` only when the rule is truly platform-specific and you have evidence.
- `support` must include `config`, `skills`, `commands`, `agents`, and `dotAgents`; each of those must include both `global` and `local`.
- Treat `local` support as project/workspace-scoped support rooted at `${CWD}`. In user-facing wording, call this local/project support.
- Every `support.*.*` leaf must include `status`, `paths`, `sources`, and `confidence`; `notes` is optional.
- Support `status` must be one of `supported`, `unsupported`, `unknown`.
- Support `confidence` must be one of `official`, `source`, `observed`, `inferred`, `unknown`.
- Support path entries reuse the existing path vocabulary where possible: `id`, `kind`, `template`, optional `platforms`, optional `description`.
- Unknown support data must be explicit: prefer `status: "unknown"`, `confidence: "unknown"`, and empty `paths` / `sources` arrays instead of partial or omitted leaves.
- Keep top-level `version` at `1`.
- Keep contributor-facing support documentation aligned across `docs/api.md`, `docs/configuration.md`, and `docs/support-matrix.md`.
- After editing `support`, regenerate `docs/support-matrix.md` and run
  `mise run docs:check` so stale generated docs fail locally before CI.
- When upgrading a leaf from `unknown`, prefer the evidence order official docs
  first, then upstream source, then observed installs; leave the leaf `unknown`
  if none of those produce defensible evidence.

## 5. Env root guidance

When a harness documents an env var that relocates its config/data/state root, model that with `roots[]` first, then reference the derived root from `paths[]`.

Preferred pattern:

```json
{
  "roots": [
    {
      "name": "CODEX_ROOT",
      "env": "CODEX_HOME",
      "fallback": "${HOME}/.codex"
    }
  ],
  "paths": [
    {
      "id": "config",
      "category": "config",
      "kind": "file",
      "template": "${CODEX_ROOT}/config.toml"
    }
  ]
}
```

Rules:

- Prefer derived roots like `${CODEX_ROOT}` or `${GEMINI_ROOT}` over repeating raw `${HOME}/...` templates.
- Use `use` when the documented override needs transformation before becoming the effective root.
- Keep `env[]` descriptions in sync with any root overrides you model.
- Do not add env vars to `env[]` unless they are real, documented variables.

## 6. Source URL expectations

`sources[]` is not filler. It should explain why the rule exists.

- Include the exact doc or repo URL that supports the path, executable name, or env-root override.
- When one source does not cover everything, include multiple URLs.
- Keep the URLs stable and readable; prefer canonical docs over search results.
- Do not remove an existing source unless the rule it supports is removed or replaced with better evidence.

### Support sources and confidence

- `official` means first-party product/docs explicitly document the support surface.
- `source` means upstream source/repository evidence supports it even if docs do not.
- `observed` means the path/surface was reproduced from a real installation.
- `inferred` means the conclusion is reasoned from nearby evidence and should be used sparingly.
- `unknown` means the registry contract is being filled in but confidence is not established yet.
- When a support surface is still `unknown`, prefer empty `sources` over weak
  guesses; add a short `notes` caveat only when it helps explain what remains
  unverified.
- Use empty `sources` only for `unknown` leaves or rare `observed`/`inferred` leaves where no direct URL exists; otherwise attach evidence URLs.

## 7. Platform caveats

- Use `platforms` only for truly OS-specific paths or install locations.
- Avoid assuming macOS/Linux/Windows parity unless the source says so.
- Do not encode `.exe` or app-bundle-specific paths unless they are documented and intentionally platform-gated.
- Prefer project-relative paths like `${CWD}/...` only for documented per-project state/config.
- For `support.local`, `${CWD}` is the default workspace/project root anchor.
- The local smoke test is hermetic and may skip harnesses that are not fixtureable on the current platform; that is normal.

## 8. What not to change

Do **not**:

- edit `packages/typescript/data/harnesses.json` directly
- edit `packages/golang/harnessdetect/data/harnesses.json` directly
- rename an existing `key`
- replace a documented root override with a hardcoded `${HOME}/...` path
- add guessed paths with no evidence URL
- add package-specific behavior when a data-only registry edit is sufficient
- remove required fields because a harness does not use them

## 9. Quick example workflow

1. Pick one `support.*.*` leaf (or one harness's set of leaves) that is still
   `unknown` in `packages/data/harnesses.json` / `docs/support-matrix.md`.
2. Verify official docs first, then upstream source if needed.
3. Update the registry leaf with `status`, `paths`, `sources`, `confidence`,
   and any short `notes` that explain caveats.
4. If the harness has a documented root override, model it with `roots[]` and
   reference that root from `paths[]`.
5. Run:

   ```sh
   mise run registry:sync
   node scripts/generate-support-matrix.mjs --summary
   mise run docs:check
   mise run registry:check
   mise run parity:check
   mise run api:check
   mise run ts:test
   mise run ts:types
   mise run ts:smoke
   mise run go:test
   mise run go:vet
   ```

6. Use the printed `supported` / `unsupported` / `unknown` totals as the live
   scouting progress report; do not maintain a parallel checklist.

This is the canonical-first workflow. If you follow it, you do not need to guess which registry file is authoritative.
