import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkHarness, listHarnesses } from "../src/index.js";

function makeDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function makeFile(filePath, content = "fixture") {
  makeDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function makeExecutable(binDir, name) {
  const executablePath = path.join(binDir, name);
  makeFile(executablePath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(executablePath, 0o755);
}

function makeFixtureForPath(entry) {
  if (entry.kind === "dir") {
    makeDir(entry.path);
    return;
  }

  makeFile(entry.path);
}

function buildEnv(rootDir) {
  const home = path.join(rootDir, "home");
  const cwd = path.join(rootDir, "cwd");
  const bin = path.join(rootDir, "bin");
  const xdgConfigHome = path.join(home, ".config");
  const xdgDataHome = path.join(home, ".local", "share");
  const xdgStateHome = path.join(home, ".local", "state");
  const xdgCacheHome = path.join(home, ".cache");

  makeDir(home);
  makeDir(cwd);
  makeDir(bin);

  return {
    cwd,
    bin,
    env: {
      HOME: home,
      PATH: bin,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgStateHome,
      XDG_CACHE_HOME: xdgCacheHome,
      CODEX_HOME: path.join(rootDir, "overrides", "codex"),
      CLAUDE_CONFIG_DIR: path.join(rootDir, "overrides", "claude"),
      GEMINI_CLI_HOME: path.join(rootDir, "overrides", "gemini-home"),
      OPENCODE_CONFIG_DIR: path.join(rootDir, "overrides", "opencode-config"),
      GOOSE_PATH_ROOT: path.join(rootDir, "overrides", "goose"),
      CLINE_DIR: path.join(rootDir, "overrides", "cline"),
      Q_CLI_DATA_DIR: path.join(rootDir, "overrides", "amazon-q"),
      COPILOT_HOME: path.join(rootDir, "overrides", "copilot"),
      COPILOT_CACHE_HOME: path.join(rootDir, "overrides", "copilot-cache"),
      AMP_DATA_HOME: path.join(rootDir, "overrides", "amp-data"),
      HERMES_HOME: path.join(rootDir, "overrides", "hermes"),
      OPENCLAW_HOME: path.join(rootDir, "overrides", "openclaw"),
      OPENCLAW_STATE_DIR: path.join(rootDir, "overrides", "openclaw-state"),
      AUTOGENSTUDIO_APPDIR: path.join(rootDir, "overrides", "autogenstudio")
    }
  };
}

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-detect-smoke-"));
const { cwd, bin, env } = buildEnv(rootDir);
const harnesses = listHarnesses();
const exercised = [];
const skipped = [];

try {
  for (const harness of harnesses) {
    const before = checkHarness(harness.key, { env, cwd });

    // only consider paths inside the temp fixture tree for hermetic testing
    const inTreePaths = before.paths.filter((entry) => entry.path && entry.path.startsWith(rootDir));
    const hostMatched = before.paths.filter((entry) => entry.path && !entry.path.startsWith(rootDir) && entry.exists);
    const hermeticInstalled = Boolean(before.executablePath || inTreePaths.some((entry) => entry.exists));

    assert.equal(hermeticInstalled, false, `${harness.key} should start as not installed in isolated env`);

    const fixturePath = inTreePaths.find((entry) => entry.path);
    const canCreateExecutable = (harness.executables || []).length > 0;

    if (!fixturePath && !canCreateExecutable) {
      const reasonParts = ["no fixtureable path or executable on this platform"];
      if (hostMatched.length > 0) {
        reasonParts.push(`(host-only evidence skipped: ${hostMatched.map((p) => p.id).join(", ")})`);
      }
      skipped.push({ key: harness.key, reason: reasonParts.join(" ") });
      continue;
    }

    if (canCreateExecutable) {
      makeExecutable(bin, harness.executables[0]);
    }

    if (fixturePath) {
      makeFixtureForPath(fixturePath);
    }

    const after = checkHarness(harness.key, { env, cwd });
    assert.equal(after.installed, true, `${harness.key} should become installed after fixture setup`);

    exercised.push({
      key: harness.key,
      executable: canCreateExecutable ? harness.executables[0] : null,
      path: fixturePath ? fixturePath.path : null
    });
  }

  console.log(JSON.stringify({
    platform: process.platform,
    exercisedCount: exercised.length,
    skippedCount: skipped.length,
    exercised,
    skipped
  }, null, 2));
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
