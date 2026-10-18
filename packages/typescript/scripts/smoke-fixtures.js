import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkHarness, listHarnesses } from "../src/index.js";

const makeDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const makeFile = (filePath, content = "fixture") => {
  makeDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
};

const makeExecutable = (binDir, name) => {
  assert.equal(path.basename(name), name, "executable must be a basename");
  const executablePath = path.join(
    binDir,
    process.platform === "win32" ? `${name}.EXE` : name
  );
  makeFile(executablePath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
};

const makeFixtureForPath = (entry) => {
  if (entry.kind === "dir") {
    makeDir(entry.path);
    return;
  }

  makeFile(entry.path);
};

const buildEnv = (rootDir) => {
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
    bin,
    cwd,
    env: {
      AMP_DATA_HOME: path.join(rootDir, "overrides", "amp-data"),
      APPDATA: path.join(home, "AppData", "Roaming"),
      AUTOGENSTUDIO_APPDIR: path.join(rootDir, "overrides", "autogenstudio"),
      CLAUDE_CONFIG_DIR: path.join(rootDir, "overrides", "claude"),
      CLINE_DIR: path.join(rootDir, "overrides", "cline"),
      CODEX_HOME: path.join(rootDir, "overrides", "codex"),
      COPILOT_CACHE_HOME: path.join(rootDir, "overrides", "copilot-cache"),
      COPILOT_HOME: path.join(rootDir, "overrides", "copilot"),
      GEMINI_CLI_HOME: path.join(rootDir, "overrides", "gemini-home"),
      GOOSE_PATH_ROOT: path.join(rootDir, "overrides", "goose"),
      HERMES_HOME: path.join(rootDir, "overrides", "hermes"),
      HOME: home,
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      OPENCLAW_HOME: path.join(rootDir, "overrides", "openclaw"),
      OPENCLAW_STATE_DIR: path.join(rootDir, "overrides", "openclaw-state"),
      OPENCODE_CONFIG_DIR: path.join(rootDir, "overrides", "opencode-config"),
      PATH: bin,
      Q_CLI_DATA_DIR: path.join(rootDir, "overrides", "amazon-q"),
      TMPDIR: path.join(rootDir, "tmp"),
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgStateHome,
    },
  };
};

const isWithinRoot = (rootDir, candidate) => {
  if (!candidate) {
    return false;
  }
  const relative = path.relative(rootDir, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const isolated = (run) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "harness-detect-smoke-")
  );
  try {
    return run(rootDir, buildEnv(rootDir));
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
};

export const runSmoke = (harnesses = listHarnesses(), check = checkHarness) => {
  const exercised = [];
  const skipped = [];
  const scenarios = [];

  for (const harness of harnesses) {
    const signals = isolated((rootDir, { env, cwd }) => {
      const initial = check(harness.key, { cwd, env });
      const fixtureable = initial.paths.filter((entry) =>
        isWithinRoot(rootDir, entry.path)
      );
      for (const entry of initial.paths.filter(
        (candidate) => !isWithinRoot(rootDir, candidate.path)
      )) {
        skipped.push({
          key: harness.key,
          pathId: entry.id,
          reason: entry.path ? "path outside fixture tree" : "unresolved path",
        });
      }
      return [
        ...harness.executables.map((name) => ({ executable: name })),
        ...fixtureable.map((entry) => ({ pathId: entry.id })),
      ];
    });

    if (!signals.length) {
      skipped.push({
        key: harness.key,
        reason: "no fixtureable path or executable on this platform",
      });
      continue;
    }

    for (const signal of signals) {
      isolated((rootDir, { env, cwd, bin }) => {
        const before = check(harness.key, { cwd, env });
        assert.equal(
          before.executablePath,
          null,
          `${harness.key}: clean PATH must not match`
        );
        assert.ok(
          !before.matchedPaths.some((entry) =>
            isWithinRoot(rootDir, entry.path)
          ),
          `${harness.key}: clean fixture tree must not match`
        );

        if (signal.executable) {
          const executablePath = makeExecutable(bin, signal.executable);
          const after = check(harness.key, { cwd, env });
          assert.equal(
            after.installed,
            true,
            `${harness.key}: executable-only detection must work for ${signal.executable}`
          );
          assert.equal(after.executablePath, executablePath);
          assert.ok(
            !after.matchedPaths.some((entry) =>
              isWithinRoot(rootDir, entry.path)
            ),
            "executable-only scenario must not create detection paths"
          );
        } else {
          const entry = before.paths.find(
            (candidate) => candidate.id === signal.pathId
          );
          assert.ok(
            isWithinRoot(rootDir, entry?.path),
            "fixture path must remain inside its temporary tree"
          );
          makeFixtureForPath(entry);
          const after = check(harness.key, { cwd, env });
          assert.equal(
            after.installed,
            true,
            `${harness.key}: path-only detection must work for ${signal.pathId}`
          );
          assert.equal(
            after.executablePath,
            null,
            "path-only scenario must not match an executable"
          );
          assert.ok(
            after.matchedPaths.some(
              (match) => match.id === signal.pathId && match.path === entry.path
            ),
            `${harness.key}: expected path match ${signal.pathId}`
          );
        }
        scenarios.push({ key: harness.key, ...signal });
      });
    }
    exercised.push(harness.key);
  }
  return {
    exercised,
    exercisedCount: exercised.length,
    platform: process.platform,
    scenarioCount: scenarios.length,
    scenarios,
    skipped,
    skippedCount: skipped.length,
  };
};

// eslint-disable-next-line unicorn/prefer-import-meta-properties -- Keep Node 18 support for the smoke script.
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  console.log(JSON.stringify(runSmoke(), null, 2));
}
