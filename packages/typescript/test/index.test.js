import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkHarness,
  detectHarnesses,
  detectInstalledHarnesses,
  getHarnessMatrix,
  getHarnessSupport,
  getRawHarnessData,
  listHarnesses,
  listHarnessSupport,
} from "../src/index.js";

const LOCKED_RUNTIME_EXPORTS = [
  "checkHarness",
  "detectHarnesses",
  "detectInstalledHarnesses",
  "getHarnessMatrix",
  "getHarnessSupport",
  "getRawHarnessData",
  "listHarnessSupport",
  "listHarnesses",
];

const SHARED_REGISTRY_URL = new URL(
  "../../data/harnesses.json",
  import.meta.url
);
const PACKAGED_REGISTRY_URL = new URL(
  "../data/harnesses.json",
  import.meta.url
);

test("matrix is readable", () => {
  const matrix = getHarnessMatrix();
  assert.equal(matrix.version, 1);
  assert.ok(matrix.harnesses.length >= 10);
});

test("public runtime exports stay locked", async () => {
  const runtimeApi = await import("../src/index.js");

  assert.deepEqual(
    new Set(Object.keys(runtimeApi)),
    new Set(LOCKED_RUNTIME_EXPORTS)
  );
});

test("getRawHarnessData returns a defensive deep clone", () => {
  const first = getRawHarnessData();
  const second = getRawHarnessData();

  first.version = 999;
  first.harnesses[0].name = "MUTATED";
  first.harnesses[0].aliases.push("MUTATED");
  first.harnesses.push({
    aliases: [],
    env: [],
    executables: [],
    key: "mutated",
    name: "MUTATED",
    paths: [],
    sources: ["https://example.com"],
  });

  assert.notEqual(second.version, 999);
  assert.notEqual(second.harnesses[0]?.name, "MUTATED");
  assert.ok(!second.harnesses[0]?.aliases.includes("MUTATED"));
  assert.ok(!second.harnesses.some((harness) => harness.key === "mutated"));
});

test("getHarnessMatrix remains a compatibility alias for raw harness data", () => {
  assert.deepEqual(getHarnessMatrix(), getRawHarnessData());
});

test("public registry surfaces expose defensive installation clones", () => {
  const canonical = getRawHarnessData();
  const canonicalCodex = canonical.harnesses.find(
    (harness) => harness.key === "codex"
  );
  assert.ok(canonicalCodex, "codex must exist in canonical registry");

  const matrixCodex = getHarnessMatrix().harnesses.find(
    (harness) => harness.key === "codex"
  );
  const listedCodex = listHarnesses().find(
    (harness) => harness.key === "codex"
  );

  assert.ok(matrixCodex, "codex must exist in getHarnessMatrix()");
  assert.ok(listedCodex, "codex must exist in listHarnesses()");

  matrixCodex.installations.push({
    method: "manual",
    url: "https://example.com",
  });
  listedCodex.installations.push({
    method: "manual",
    url: "https://example.com",
  });
  matrixCodex.installations[0].platforms?.push("plan9");
  listedCodex.installations[0].platforms?.push("plan9");

  const matrixAgain = getHarnessMatrix().harnesses.find(
    (harness) => harness.key === "codex"
  );
  const listedAgain = listHarnesses().find(
    (harness) => harness.key === "codex"
  );

  assert.deepEqual(
    matrixAgain?.installations,
    canonicalCodex.installations,
    "getHarnessMatrix() must return canonical installations"
  );
  assert.deepEqual(
    listedAgain?.installations,
    canonicalCodex.installations,
    "listHarnesses() must return canonical installations"
  );
});

test("support APIs return defensive deep clones", () => {
  const canonicalCodex = getRawHarnessData().harnesses.find(
    (harness) => harness.key === "codex"
  );
  assert.ok(canonicalCodex?.support, "codex must expose support metadata");

  const first = getHarnessSupport("codex");
  const second = getHarnessSupport("codex");
  const listed = listHarnessSupport();
  const listedCodex = listed.find((harness) => harness.key === "codex");

  assert.ok(listedCodex?.support, "codex must exist in listHarnessSupport()");

  first.support.config.global.paths.push({
    id: "MUTATED",
    kind: "file",
    template: "MUTATED",
  });
  first.support.config.global.sources.push("https://example.com");
  first.support.config.global.status = "unsupported";
  first.support.config.global.confidence = "unknown";
  listedCodex.support.config.local.paths.push({
    id: "MUTATED-LOCAL",
    kind: "dir",
    template: "MUTATED",
  });

  const third = getHarnessSupport("codex");
  const listedAgain = listHarnessSupport().find(
    (harness) => harness.key === "codex"
  );

  assert.deepEqual(
    second.support,
    canonicalCodex.support,
    "getHarnessSupport() must return canonical support data"
  );
  assert.deepEqual(
    third.support,
    canonicalCodex.support,
    "mutating prior getHarnessSupport() data must not affect later calls"
  );
  assert.deepEqual(
    listedAgain?.support,
    canonicalCodex.support,
    "listHarnessSupport() must return canonical support data"
  );
});

test("listHarnesses exposes defensive support clones", () => {
  const first = listHarnesses().find((harness) => harness.key === "codex");
  const second = listHarnesses().find((harness) => harness.key === "codex");

  assert.ok(first?.support, "codex must expose support metadata");
  assert.ok(second?.support, "codex must expose support metadata");

  first.support.skills.global.paths.push({
    id: "MUTATED",
    kind: "dir",
    template: "MUTATED",
  });

  assert.ok(
    !second.support.skills.global.paths.some((entry) => entry.id === "MUTATED")
  );
});

test("packaged registry stays byte-for-byte synced with the shared registry", () => {
  const sharedRegistry = fs.readFileSync(SHARED_REGISTRY_URL);
  const packagedRegistry = fs.readFileSync(PACKAGED_REGISTRY_URL);

  assert.ok(
    packagedRegistry.equals(sharedRegistry),
    "packages/typescript/data/harnesses.json must match packages/data/harnesses.json byte-for-byte"
  );
});

const VERIFIED_NEW_HARNESS_KEYS = [
  "antigravity-cli",
  "devin-for-terminal",
  "grok-build-cli",
  "junie-cli",
  "kilo-code",
  "kimi-code-cli",
  "kiro-cli",
  "letta-code",
  "nanocoder",
  "openblock",
  "pi",
  "qoder-cli",
  "rovo-dev-cli",
  "toad",
];

test("verified harness additions are present", () => {
  const keys = new Set(
    getHarnessMatrix().harnesses.map((harness) => harness.key)
  );

  for (const key of VERIFIED_NEW_HARNESS_KEYS) {
    assert.ok(keys.has(key), `registry is missing verified harness: ${key}`);
  }
});

test("checkHarness resolves env overrides", () => {
  const result = checkHarness("codex", {
    cwd: "/repo",
    env: {
      CODEX_HOME: "/tmp/codex-home",
      HOME: "/Users/test",
      PATH: "",
    },
  });

  const config = result.paths.find((entry) => entry.id === "config");
  const project = result.paths.find((entry) => entry.id === "project-config");

  assert.equal(config?.path, "/tmp/codex-home/config.toml");
  assert.equal(project?.path, "/repo/.codex/config.toml");
});

test("checkHarness resolves harness-specific derived roots", () => {
  const result = checkHarness("hermes-agent", {
    cwd: "/repo",
    env: {
      HERMES_HOME: "/tmp/hermes-home",
      HOME: "/Users/test",
      PATH: "",
    },
  });

  const config = result.paths.find((entry) => entry.id === "config");
  const sessions = result.paths.find((entry) => entry.id === "sessions");

  assert.equal(config?.path, "/tmp/hermes-home/config.yaml");
  assert.equal(sessions?.path, "/tmp/hermes-home/sessions");
});

test("aliases map to the same harness", () => {
  const byKey = checkHarness("claude-code", {
    cwd: "/repo",
    env: { HOME: "/Users/test", PATH: "" },
  });
  const byAlias = checkHarness("claude", {
    cwd: "/repo",
    env: { HOME: "/Users/test", PATH: "" },
  });

  assert.equal(byKey.key, byAlias.key);
});

test("detectHarnesses checks the whole registry", () => {
  const all = detectHarnesses({
    cwd: "/repo",
    env: { HOME: "/Users/test", PATH: "" },
  });
  assert.equal(all.length, listHarnesses().length);
});

test("detectInstalledHarnesses returns only installed harnesses", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const claudeDir = path.join(tmp, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), "{}");

    const installed = detectInstalledHarnesses({
      cwd: "/repo",
      env: { HOME: tmp, PATH: "" },
    });
    const all = detectHarnesses({ cwd: "/repo", env: { HOME: tmp, PATH: "" } });
    const installedViaFilter = all.filter((r) => r.installed);

    assert.equal(
      installed.length,
      installedViaFilter.length,
      "detectInstalledHarnesses must match detectHarnesses().filter(installed)"
    );
    for (const r of installed) {
      assert.equal(
        r.installed,
        true,
        "every entry in detectInstalledHarnesses must be installed"
      );
    }
    assert.ok(
      installed.some((r) => r.key === "claude-code"),
      "claude-code should be installed in this fixture"
    );
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("checkHarness throws for unknown harness", () => {
  assert.throws(() => checkHarness("nonexistent-harness"), {
    message: "Unknown harness: nonexistent-harness",
    name: "Error",
  });
});

test("unresolved env placeholder yields null path", () => {
  const result = checkHarness("amazon-q-cli", {
    cwd: "/repo",
    env: { HOME: "/Users/test", PATH: "" },
  });
  const dataRoot = result.paths.find((p) => p.id === "data-root-env");
  assert.equal(dataRoot.path, null);
  assert.equal(dataRoot.exists, false);
});

test("platform-gated entries are included on matching platform", () => {
  const result = checkHarness("cursor", {
    cwd: "/repo",
    env: { HOME: "/Users/test", PATH: "" },
  });
  const appMacos = result.paths.find((p) => p.id === "app-macos");

  if (process.platform === "darwin") {
    assert.ok(appMacos, "app-macos entry should not be filtered on darwin");
    assert.equal(appMacos.path, "/Applications/Cursor.app");
    return;
  }

  assert.equal(
    appMacos,
    undefined,
    "app-macos entry should be filtered outside darwin"
  );
});

test("path-only match makes harness installed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const claudeDir = path.join(tmp, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), "{}");

    const result = checkHarness("claude-code", {
      cwd: "/repo",
      env: { HOME: tmp, PATH: "" },
    });
    assert.equal(result.installed, true);
    assert.equal(result.executablePath, null);
    assert.ok(result.matchedPaths.length > 0);
    const settingsMatch = result.matchedPaths.find((p) => p.id === "settings");
    assert.ok(settingsMatch, "settings file should be matched");
    assert.ok(settingsMatch.exists);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("executable match makes harness installed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const exePath = path.join(binDir, "codex");
    fs.writeFileSync(exePath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(exePath, 0o755);

    const result = checkHarness("codex", {
      cwd: "/repo",
      env: { HOME: "/Users/test", PATH: binDir },
    });
    assert.equal(result.installed, true);
    assert.equal(result.executablePath, exePath);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test(
  "non-executable PATH file does not make harness installed",
  { skip: process.platform === "win32" },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    try {
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const exePath = path.join(binDir, "codex");
      fs.writeFileSync(exePath, "#!/bin/sh\nexit 0\n");
      fs.chmodSync(exePath, 0o644);

      const result = checkHarness("codex", {
        cwd: "/repo",
        env: { HOME: tmp, PATH: binDir },
      });

      assert.equal(result.installed, false);
      assert.equal(result.executablePath, null);
    } finally {
      fs.rmSync(tmp, { force: true, recursive: true });
    }
  }
);

test("reasons and matchedPaths are populated for executable and path matches", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const exePath = path.join(binDir, "codex");
    fs.writeFileSync(exePath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(exePath, 0o755);

    const codexHome = path.join(tmp, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "config.toml"), "");

    const result = checkHarness("codex", {
      cwd: "/repo",
      env: { CODEX_HOME: codexHome, HOME: tmp, PATH: binDir },
    });

    assert.equal(result.installed, true);

    const execReason = result.reasons.find((r) => r === "executable:codex");
    assert.ok(execReason, "should have executable reason");

    const configReason = result.reasons.find((r) => r === "config:config");
    assert.ok(configReason, "should have config path reason");

    const configMatch = result.matchedPaths.find((p) => p.id === "config");
    assert.ok(configMatch, "config path should be matched");
    assert.equal(configMatch.path, path.join(codexHome, "config.toml"));
    assert.equal(configMatch.exists, true);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("mutation of CheckHarness result does not affect subsequent calls", () => {
  const options = { cwd: "/repo", env: { HOME: "/Users/test", PATH: "" } };
  const platformFixture = {
    darwin: { harness: "cursor", pathId: "app-macos" },
    linux: { harness: "warp", pathId: "config-linux" },
  }[process.platform];

  const first = checkHarness("claude-code", options);
  const second = checkHarness("claude-code", options);
  const platformFirst = platformFixture
    ? checkHarness(platformFixture.harness, options)
    : null;
  const platformSecond = platformFixture
    ? checkHarness(platformFixture.harness, options)
    : null;

  // Mutate every slice-shaped field on the first result.
  first.harness.aliases.push("MUTATED");
  first.harness.executables.push("MUTATED");
  first.harness.paths.push({
    category: "config",
    id: "MUTATED",
    kind: "file",
    template: "MUTATED",
  });
  first.harness.env.push({ description: "MUTATED", name: "MUTATED" });
  first.harness.sources.push("MUTATED");
  first.harness.installations.push({
    method: "manual",
    url: "https://example.com",
  });
  first.harness.installations[0].platforms?.push("plan9");
  first.harness.support.config.global.paths.push({
    id: "MUTATED",
    kind: "file",
    template: "MUTATED",
  });
  first.harness.support.config.global.sources.push("https://example.com");
  first.paths.push({
    category: "config",
    exists: false,
    id: "MUTATED",
    kind: "file",
    path: null,
    platforms: undefined,
    template: "MUTATED",
  });
  first.matchedPaths.push({
    category: "config",
    exists: false,
    id: "MUTATED",
    kind: "file",
    path: null,
    platforms: undefined,
    template: "MUTATED",
  });
  first.reasons.push("MUTATED");

  const platformPath = platformFirst?.paths.find(
    (p) => p.id === platformFixture?.pathId
  );
  if (platformFixture) {
    assert.ok(
      platformPath?.platforms,
      `${platformFixture.harness} ${platformFixture.pathId} fixture must have platforms`
    );
    platformPath.platforms.push("plan9");
  }

  // The second call must still return the canonical data.
  assert.ok(
    !second.harness.aliases.includes("MUTATED"),
    "harness.aliases aliases the package matrix"
  );
  assert.ok(
    !second.harness.executables.includes("MUTATED"),
    "harness.executables aliases the package matrix"
  );
  assert.ok(
    !second.harness.paths.some((p) => p.id === "MUTATED"),
    "harness.paths aliases the package matrix"
  );
  assert.ok(
    !second.harness.env.some((e) => e.name === "MUTATED"),
    "harness.env aliases the package matrix"
  );
  assert.ok(
    !second.harness.sources.includes("MUTATED"),
    "harness.sources aliases the package matrix"
  );
  assert.ok(
    !second.harness.installations.some(
      (installation) => installation.url === "https://example.com"
    ),
    "harness.installations aliases the package matrix"
  );
  assert.ok(
    !second.harness.installations.some((installation) =>
      installation.platforms?.includes("plan9")
    ),
    "harness.installations[].platforms aliases the package matrix"
  );
  assert.ok(
    !second.harness.support.config.global.paths.some((p) => p.id === "MUTATED"),
    "harness.support paths alias the package matrix"
  );
  assert.ok(
    !second.harness.support.config.global.sources.includes(
      "https://example.com"
    ),
    "harness.support sources alias the package matrix"
  );
  assert.ok(
    !second.paths.some((p) => p.id === "MUTATED"),
    "paths aliases an internal slice"
  );
  assert.ok(
    !second.matchedPaths.some((p) => p.id === "MUTATED"),
    "matchedPaths aliases an internal slice"
  );
  assert.ok(
    !second.reasons.includes("MUTATED"),
    "reasons aliases an internal slice"
  );
  assert.ok(
    !platformSecond?.paths.some((p) => p.platforms?.includes("plan9")),
    "paths[].platforms aliases the package matrix"
  );
});

test("env-var table in docs/configuration.md is in sync with the registry", () => {
  const docsUrl = new URL("../../../docs/configuration.md", import.meta.url);
  const docs = fs.readFileSync(docsUrl, "utf-8");
  const match = docs.match(
    /<!-- BEGIN: env-var-table -->(?<table>[\s\S]*?)<!-- END: env-var-table -->/u
  );
  assert.ok(match, "docs/configuration.md must contain env-var table markers");
  const tableInDoc = match.groups.table.trim();

  const result = spawnSync("node", ["scripts/generate-env-table.js"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf-8",
  });
  assert.equal(result.status, 0, "generator must exit 0");
  const expected = result.stdout.trim();

  assert.equal(
    tableInDoc,
    expected,
    "docs/configuration.md env-var table is out of sync; run `mise run docs:generate`"
  );
});

const isWindows = process.platform === "win32";

test("Windows: .exe in PATH is detected", { skip: !isWindows }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const exePath = path.join(binDir, "codex.exe");
    fs.writeFileSync(exePath, "");

    const result = checkHarness("codex", {
      cwd: "/repo",
      env: {
        HOME: "/Users/test",
        PATH: binDir,
        PATHEXT: ".EXE;.CMD;.BAT;.COM",
      },
    });
    assert.equal(result.installed, true);
    assert.equal(result.executablePath, exePath);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test(
  "Windows: .bat in PATH is detected when PATHEXT includes .BAT",
  { skip: !isWindows },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    try {
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const batPath = path.join(binDir, "codex.bat");
      fs.writeFileSync(batPath, "");

      const result = checkHarness("codex", {
        cwd: "/repo",
        env: {
          HOME: "/Users/test",
          PATH: binDir,
          PATHEXT: ".EXE;.CMD;.BAT;.COM",
        },
      });
      assert.equal(result.installed, true);
      assert.equal(result.executablePath, batPath);
    } finally {
      fs.rmSync(tmp, { force: true, recursive: true });
    }
  }
);

test(
  "Windows: file in PATH with no matching PATHEXT is not detected",
  { skip: !isWindows },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    try {
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, "codex"), "");

      const result = checkHarness("codex", {
        cwd: "/repo",
        env: { HOME: "/Users/test", PATH: binDir, PATHEXT: ".EXE" },
      });
      assert.equal(result.installed, false);
      assert.equal(result.executablePath, null);
    } finally {
      fs.rmSync(tmp, { force: true, recursive: true });
    }
  }
);

test("canonical registry passes schema and semantic validation", () => {
  const result = spawnSync("node", ["../../scripts/validate-registry.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf-8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("registry retains verified installation metadata", () => {
  const matrix = getRawHarnessData();
  assert.ok(
    matrix.harnesses
      .find((harness) => harness.key === "codex")
      .installations.some(
        (installation) =>
          installation.method === "npm" &&
          installation.package === "@openai/codex"
      )
  );
  assert.ok(
    matrix.harnesses.some((harness) =>
      harness.installations.some(
        (installation) => installation.method === "unknown"
      )
    )
  );
});
