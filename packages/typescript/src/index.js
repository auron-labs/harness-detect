import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const matrixUrl = new URL("../data/harnesses.json", import.meta.url);
const matrix = JSON.parse(fs.readFileSync(matrixUrl, "utf8"));

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function withDefaults(env = process.env, cwd = process.cwd()) {
  const home = env.HOME || os.homedir();
  const xdgConfigHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const xdgDataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const xdgStateHome = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  const xdgCacheHome = env.XDG_CACHE_HOME || path.join(home, ".cache");

  return {
    ...env,
    HOME: home,
    USERPROFILE: env.USERPROFILE || home,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: xdgCacheHome,
    TMPDIR: env.TMPDIR || os.tmpdir(),
    CWD: cwd
  };
}

function resolveHarnessRoots(harness, baseEnv) {
  const resolved = { ...baseEnv };

  for (const root of (harness.roots || [])) {
    const envVal = root.env ? baseEnv[root.env] : undefined;

    let value;
    if (root.env && envVal) {
      if (root.use) {
        // Resolve "use" template against baseEnv + resolved roots + the env var
        const tmp = { ...resolved, [root.env]: envVal };
        value = resolveTemplate(root.use, tmp);
      } else {
        value = envVal;
      }
    } else {
      value = resolveTemplate(root.fallback, resolved);
    }

    if (value !== null && value !== "") {
      resolved[root.name] = path.normalize(value);
    }
  }

  return resolved;
}

function platformMatches(platforms) {
  return !platforms || platforms.includes(process.platform);
}

function resolveTemplate(template, env) {
  if (!template) {
    return null;
  }

  let unresolved = false;
  const resolved = template.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const value = env[name];

    if (value === undefined || value === null || value === "") {
      unresolved = true;
      return "";
    }

    return value;
  });

  if (unresolved) {
    return null;
  }

  return path.normalize(resolved);
}

function pathTypeMatches(kind, candidatePath) {
  try {
    const stat = fs.statSync(candidatePath);
    return kind === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

function executableFileMatches(candidatePath) {
  if (!pathTypeMatches("file", candidatePath)) {
    return false;
  }

  if (process.platform === "win32") {
    return true;
  }

  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePaths(harness, env) {
  return harness.paths
    .filter((entry) => platformMatches(entry.platforms))
    .map((entry) => {
      const resolved = resolveTemplate(entry.template, env);
      const exists = resolved ? pathTypeMatches(entry.kind, resolved) : false;

      return {
        ...entry,
        ...(entry.platforms === undefined ? {} : { platforms: [...entry.platforms] }),
        path: resolved,
        exists
      };
    });
}

function findExecutable(executables, env) {
  if (!executables.length) {
    return null;
  }

  const pathValue = env.PATH || "";
  const pathParts = pathValue.split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const executable of executables) {
    for (const dir of pathParts) {
      for (const ext of exts) {
        const candidate = path.join(dir, process.platform === "win32" ? `${executable}${ext}` : executable);
        if (executableFileMatches(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function normalizeKey(input) {
  return String(input).trim().toLowerCase();
}

function getHarnessDefinition(input) {
  const key = normalizeKey(input);

  return matrix.harnesses.find((harness) => {
    if (normalizeKey(harness.key) === key) {
      return true;
    }

    return (harness.aliases || []).some((alias) => normalizeKey(alias) === key);
  }) || null;
}

function cloneHarnessSupportRecord(harness) {
  return {
    key: harness.key,
    name: harness.name,
    support: clone(harness.support)
  };
}

export function getHarnessMatrix() {
  return getRawHarnessData();
}

export function getRawHarnessData() {
  return clone(matrix);
}

export function listHarnesses() {
  return clone(matrix.harnesses);
}

export function getHarnessSupport(input) {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  return cloneHarnessSupportRecord(harness);
}

export function listHarnessSupport() {
  return matrix.harnesses.map(cloneHarnessSupportRecord);
}

export function checkHarness(input, options = {}) {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  const baseEnv = withDefaults(options.env, options.cwd);
  const env = resolveHarnessRoots(harness, baseEnv);
  const executablePath = findExecutable(harness.executables || [], env);
  const paths = resolvePaths(harness, env);
  const matchedPaths = paths.filter((entry) => entry.exists);
  const reasons = [];

  if (executablePath) {
    reasons.push(`executable:${path.basename(executablePath)}`);
  }

  for (const entry of matchedPaths) {
    reasons.push(`${entry.category}:${entry.id}`);
  }

  return {
    key: harness.key,
    name: harness.name,
    installed: Boolean(executablePath || matchedPaths.length),
    executablePath,
    harness: clone(harness),
    paths,
    matchedPaths,
    reasons
  };
}

export function detectHarnesses(options = {}) {
  return matrix.harnesses.map((harness) => checkHarness(harness.key, options));
}

export function detectInstalledHarnesses(options = {}) {
  return detectHarnesses(options).filter((result) => result.installed);
}
