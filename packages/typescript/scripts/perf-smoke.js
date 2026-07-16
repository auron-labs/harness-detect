import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { detectHarnesses, listHarnesses } from "../src/index.js";

function makeDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildEnv(rootDir) {
  const home = path.join(rootDir, "home");
  const cwd = path.join(rootDir, "cwd");

  makeDir(home);
  makeDir(cwd);
  makeDir(path.join(home, ".config"));
  makeDir(path.join(home, ".local", "share"));
  makeDir(path.join(home, ".local", "state"));
  makeDir(path.join(home, ".cache"));

  return {
    cwd,
    env: {
      HOME: home,
      PATH: "",
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_STATE_HOME: path.join(home, ".local", "state"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
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

function readIterations() {
  const raw = process.env.HARNESS_DETECT_PERF_ITERATIONS;
  if (!raw) {
    return 250;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`HARNESS_DETECT_PERF_ITERATIONS must be a positive integer, got ${raw}`);
  }

  return parsed;
}

const iterations = readIterations();
const harnessCount = listHarnesses().length;
const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-detect-perf-"));

try {
  const { cwd, env } = buildEnv(rootDir);
  const warmup = detectHarnesses({ env, cwd });
  if (warmup.length !== harnessCount) {
    throw new Error(`warmup detect count mismatch: got ${warmup.length}, want ${harnessCount}`);
  }

  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const results = detectHarnesses({ env, cwd });
    if (results.length !== harnessCount) {
      throw new Error(`detect count mismatch on iteration ${i + 1}: got ${results.length}, want ${harnessCount}`);
    }
  }
  const elapsedMs = performance.now() - startedAt;
  const opsPerSec = iterations / (elapsedMs / 1000);

  console.log(`typescript perf: ${iterations} iterations, ${opsPerSec.toFixed(2)} ops/sec, ${elapsedMs.toFixed(2)} ms elapsed, ${harnessCount} harnesses/run, PATH=empty, hermetic env`);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
