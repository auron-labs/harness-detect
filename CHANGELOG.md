# Changelog

All notable changes to this project should be recorded here.

## Release notes convention

- Add new changes under `## [Unreleased]` until a release is cut.
- Create a dated or versioned heading when publishing a release.
- Prefer short bullets grouped by type: `Added`, `Changed`, `Fixed`, `Removed`.
- Keep entries user-facing and note any breaking changes clearly.

## [Unreleased]

### Changed

- Supported-package docs now align on all four package ecosystems: npm, Go,
  crates.io, and PyPI. The npm runbook remains npm-specific, with the broader
  release gate documented separately.
- Registry versioning decision: additive `installations[]` metadata remains on registry `version: 1`; consumers should treat it as a non-breaking raw-registry surface expansion, not a schema-version bump. Strict raw-JSON consumers must tolerate additive public fields instead of assuming a closed object shape.
- Breaking (intentional for TypeScript/Go result-shape parity): `harnessdetect.HarnessCheckResult.ExecutablePath` and `harnessdetect.ResolvedHarnessPath.Path` now use `*string`, so missing values marshal as JSON `null` instead of empty strings.
- Docs now point maintainers and agents to `docs/harness-guide.md` and `docs/package-guide.md`, document `mise run registry:sync` as the write path and `mise run registry:check` as the read-only CI enforcement step, and stop treating manual file copies as the primary workflow.
- User-facing API docs now describe `getRawHarnessData()` / `GetRawHarnessData()` as the preferred raw-registry accessors while keeping TypeScript `./data` and `getHarnessMatrix()` / `GetHarnessMatrix()` compatibility paths documented.
- Release guidance now documents safe, manual recovery when publishing to one supported ecosystem fails; supported package coordinates do not imply that a package has already been published.
- Documentation stats are regenerated with Automd so README metrics remain current.
- Maintainer docs now cover local package validation tasks and their use before release.
- Privacy, reporting, and troubleshooting guidance now explains what to include when seeking support and how to avoid sharing sensitive data.

## [0.1.0] - 2026-07-02

### Added

- Established this changelog and release-notes convention.

### Changed

- Clarified launch scope in docs: `@auron-labs/harness-detect` is the current npm release artifact, while the Go package remains deferred pending a separate readiness plan.
- Linked release/support docs from the root and package READMEs, and added broken-release consumer guidance to `SUPPORT.md`.
