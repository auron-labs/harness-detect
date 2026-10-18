import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { scaffoldHarness } from "../../../scripts/scaffold-harness.mjs";
import { summarizeHarnessChanges } from "../../../scripts/summarize-harness-changes.mjs";
import {
  registryPath,
  validateRegistry,
} from "../../../scripts/validate-registry.mjs";
import { runSmoke } from "../scripts/smoke-fixtures.js";
import { checkHarness, listHarnesses } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
const minimal = () => ({
  harnesses: [structuredClone(registry.harnesses[0])],
  version: 1,
});
const cli = (script, args = []) =>
  spawnSync("node", [path.join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

test("schema validation rejects invalid structure and evidence claims", () => {
  const cases = [
    [
      "missing installation evidence",
      (h) => {
        delete h.installations[0].url;
      },
      /url/u,
    ],
    [
      "unknown property",
      (h) => {
        h.typo = true;
      },
      /additional properties/u,
    ],
    [
      "missing support category",
      (h) => {
        delete h.support.skills;
      },
      /skills/u,
    ],
    [
      "unsupported platform",
      (h) => {
        h.paths[0].platforms = ["plan9"];
      },
      /allowed values/u,
    ],
    [
      "no detection signal",
      (h) => {
        h.paths = [];
        h.executables = [];
      },
      /fewer than 1/u,
    ],
    [
      "blank alias",
      (h) => {
        h.aliases = ["  "];
      },
      /pattern/u,
    ],
    [
      "support claim without evidence",
      (h) => {
        h.support.skills.global = {
          confidence: "unknown",
          paths: [],
          sources: [],
          status: "supported",
        };
      },
      /sources|confidence/u,
    ],
    [
      "unsupported claim without evidence",
      (h) => {
        h.support.skills.global = {
          confidence: "unknown",
          paths: [],
          sources: [],
          status: "unsupported",
        };
      },
      /sources|confidence/u,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    const candidate = minimal();
    mutate(candidate.harnesses[0]);
    assert.match(validateRegistry(candidate).join("\n"), pattern, name);
  }
});

test("semantic validation rejects ambiguous lookup and repeated path/root IDs", () => {
  const candidate = minimal();
  const [first] = candidate.harnesses;
  first.aliases.push(` ${first.key.toUpperCase()} `);
  assert.deepEqual(
    validateRegistry(candidate),
    [],
    "self aliases remain valid"
  );
  const second = structuredClone(first);
  second.key = "new-harness";
  candidate.harnesses.push(second);
  assert.match(validateRegistry(candidate).join("\n"), /collides/u);
  candidate.harnesses.pop();
  first.paths.push(structuredClone(first.paths[0]));
  first.roots.push(structuredClone(first.roots[0]));
  first.support.config.global.paths.push(
    structuredClone(first.support.config.global.paths[0])
  );
  const errors = validateRegistry(candidate).join("\n");
  assert.match(errors, /\.paths: duplicate id/u);
  assert.match(errors, /\.roots: duplicate name/u);
  assert.match(errors, /support.config.global.paths: duplicate id/u);
});

test("validation CLI rejects malformed and invalid files without changing them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-cli-"));
  try {
    const filename = path.join(dir, "registry.json");
    for (const text of ["{", JSON.stringify({ harnesses: [], version: 1 })]) {
      fs.writeFileSync(filename, text);
      const result = cli("validate-registry.mjs", [filename]);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.length);
      assert.equal(result.stdout, "");
      assert.equal(fs.readFileSync(filename, "utf-8"), text);
    }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("scaffold emits an incomplete independent draft and rejects existing identifiers", () => {
  const draft = scaffoldHarness(
    registry,
    "example-harness",
    "Example Harness",
    ["example-alias"]
  );
  assert.deepEqual(draft.executables, []);
  assert.deepEqual(draft.sources, []);
  assert.deepEqual(draft.installations, []);
  assert.equal(Object.values(draft.support).flatMap(Object.values).length, 10);
  draft.support.config.global.paths.push({ id: "example" });
  assert.deepEqual(draft.support.skills.global.paths, []);
  assert.deepEqual(draft.support.config.local.paths, []);
  assert.throws(
    () => scaffoldHarness(registry, "codex", "Duplicate"),
    /collides/u
  );
  assert.throws(
    () => scaffoldHarness(registry, "new-harness", "Duplicate", [" CLAUDE "]),
    /collides/u
  );
  assert.throws(
    () => scaffoldHarness(registry, "CLAUDE", "Invalid"),
    /Key must/u
  );
  assert.throws(
    () => scaffoldHarness(registry, "new-harness", "  "),
    /non-empty/u
  );
  assert.throws(
    () => scaffoldHarness(registry, "new-harness", "Duplicate", ["x", " X "]),
    /unique/u
  );
  const before = fs.readFileSync(registryPath, "utf-8");
  const result = cli("scaffold-harness.mjs", [
    "example-harness",
    "Example Harness",
    "--alias",
    "example-alias",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).key, "example-harness");
  assert.match(result.stderr, /Draft only/u);
  assert.equal(fs.readFileSync(registryPath, "utf-8"), before);
  assert.notEqual(
    cli("scaffold-harness.mjs", ["codex", "Duplicate"]).status,
    0
  );
});

test("change summary includes additions, removals, detection rules and support changes", () => {
  const before = minimal();
  const after = structuredClone(before);
  const [h] = after.harnesses;
  h.aliases.push("new-alias");
  h.executables.push("new-executable");
  h.paths[0].template = `\${HOME}/changed`;
  h.roots[0].fallback = `\${HOME}/changed-root`;
  h.support.config.global.status = "unknown";
  const summary = summarizeHarnessChanges(before, after);
  for (const field of [
    "aliases",
    "executables",
    "paths",
    "roots",
    "support.config.global",
  ]) {
    assert.ok(summary.includes(`- ${field}:`), field);
  }
  assert.ok(!summary.includes("- support.skills.global:"));
  assert.match(
    summarizeHarnessChanges({ harnesses: [], version: 1 }, after),
    /\(added\)/u
  );
  assert.match(
    summarizeHarnessChanges(before, { harnesses: [], version: 1 }),
    /\(removed\)/u
  );
  assert.match(
    summarizeHarnessChanges(before, before),
    /No harness registry changes/u
  );
  assert.equal(
    cli("summarize-harness-changes.mjs", ["--base", "HEAD"]).status,
    0
  );
  assert.notEqual(
    cli("summarize-harness-changes.mjs", [
      "--base",
      "missing-registry-test-ref",
    ]).status,
    0
  );
});

test("tool CLIs provide help and reject unknown flags", () => {
  for (const script of [
    "validate-registry.mjs",
    "scaffold-harness.mjs",
    "summarize-harness-changes.mjs",
  ]) {
    const result = cli(script, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/u);
    assert.equal(result.stderr, "");
    assert.notEqual(cli(script, ["--invalid-option"]).status, 0);
  }
});

test("smoke isolates every signal and catches a broken path-only resolver", () => {
  const codex = listHarnesses().find((h) => h.key === "codex");
  const report = runSmoke([codex, codex]);
  assert.equal(
    report.exercisedCount,
    2,
    "the repeated harness must start in a fresh tree"
  );
  assert.ok(
    report.scenarios.some((scenario) => scenario.executable === "codex")
  );
  assert.ok(report.scenarios.some((scenario) => scenario.pathId === "config"));
  assert.throws(
    () =>
      runSmoke([codex], (key, options) => {
        const result = checkHarness(key, options);
        return { ...result, installed: Boolean(result.executablePath) };
      }),
    /path-only detection must work/u
  );
  assert.throws(
    () =>
      runSmoke([codex], (key, options) => {
        const result = checkHarness(key, options);
        return { ...result, installed: result.matchedPaths.length > 0 };
      }),
    /executable-only detection must work/u
  );
});

test("stats checker rejects stale content without writing files or consulting Git", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-stats-check-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.mkdirSync(path.join(dir, "packages", "typescript"), { recursive: true });
    fs.symlinkSync(
      path.join(repoRoot, "packages/typescript/node_modules"),
      path.join(dir, "packages/typescript/node_modules"),
      "junction"
    );
    fs.copyFileSync(
      path.join(repoRoot, "scripts/check-doc-stats.mjs"),
      path.join(dir, "scripts/check-doc-stats.mjs")
    );
    fs.writeFileSync(
      path.join(dir, "automd.config.mjs"),
      'export default { input: ["README.md"], generators: { example: { name: "example", generate: () => ({ contents: "fresh" }) } } };'
    );
    const filename = path.join(dir, "README.md");
    for (const content of ["fresh", "stale"]) {
      const text = `Uncommitted prose\n<!-- automd:example -->\n\n${content}\n\n<!-- /automd -->\n`;
      fs.writeFileSync(filename, text);
      const result = spawnSync(
        "node",
        [path.join(dir, "scripts/check-doc-stats.mjs")],
        { cwd: dir, encoding: "utf-8" }
      );
      assert.equal(result.status, content === "fresh" ? 0 : 1, result.stderr);
      assert.equal(fs.readFileSync(filename, "utf-8"), text);
    }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
