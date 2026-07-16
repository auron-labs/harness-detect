import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkHarness, detectHarnesses, getHarnessSupport, listHarnessSupport } from "../src/index.js";

function readInput(sourceArg) {
  if (sourceArg && sourceArg !== "-") {
    const sourcePath = path.resolve(process.cwd(), sourceArg);
    return fs.readFileSync(sourcePath, "utf8");
  }

  return fs.readFileSync(0, "utf8");
}

function parseInput(raw) {
  if (!raw.trim()) {
    throw new Error("Expected JSON parity cases from stdin or a file path argument.");
  }

  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;

  if (!Array.isArray(cases)) {
    throw new Error("Parity input must be an array of cases or an object with a cases array.");
  }

  return {
    version: Array.isArray(parsed) ? null : parsed.version ?? null,
    cases
  };
}

function createSandbox() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-detect-parity-"));
  const roots = {
    TMP: tempRoot,
    HOME: path.join(tempRoot, "home"),
    CWD: path.join(tempRoot, "cwd"),
    BIN: path.join(tempRoot, "bin")
  };

  for (const dirPath of Object.values(roots)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return roots;
}

function expandString(value, roots) {
  return value.replace(/\$\{(TMP|HOME|CWD|BIN)\}/g, (_, key) => roots[key]);
}

function expandValue(value, roots) {
  if (typeof value === "string") {
    return expandString(value, roots);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => expandValue(entry, roots));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandValue(entry, roots)])
    );
  }

  return value;
}

function expandCase(testCase, roots) {
  return {
    id: testCase.id,
    operation: testCase.operation,
    ...(testCase.input === undefined ? {} : { input: expandValue(testCase.input, roots) }),
    ...(testCase.platforms === undefined ? {} : { platforms: expandValue(testCase.platforms, roots) }),
    ...(testCase.cwd === undefined ? {} : { cwd: expandValue(testCase.cwd, roots) }),
    ...(testCase.env === undefined ? {} : { env: expandValue(testCase.env, roots) }),
    ...(testCase.setup === undefined ? {} : { setup: expandValue(testCase.setup, roots) })
  };
}

function normalizePathString(value, roots) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const replacements = Object.entries(roots)
    .map(([key, rootPath]) => [key, path.resolve(rootPath)])
    .sort((left, right) => right[1].length - left[1].length);

  let normalized = path.resolve(value);
  for (const [key, rootPath] of replacements) {
    if (normalized === rootPath || normalized.startsWith(`${rootPath}${path.sep}`)) {
      normalized = "${" + key + "}" + normalized.slice(rootPath.length);
      break;
    }
  }

  return normalized;
}

function isWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveSandboxPath(targetPath, sandboxRoot) {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new Error("Parity setup entries must include a non-empty path.");
  }

  if (typeof sandboxRoot !== "string" || sandboxRoot.length === 0) {
    throw new Error(`Parity setup path requires a tempRoot sandbox: ${targetPath}`);
  }

  const sandboxRealPath = fs.realpathSync.native(sandboxRoot);
  const absoluteTargetPath = path.resolve(targetPath);
  const missingSegments = [];
  let existingPath = absoluteTargetPath;

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      throw new Error(`Could not resolve a parity setup parent for ${targetPath}`);
    }

    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  const existingStat = fs.lstatSync(existingPath);
  if (existingPath === absoluteTargetPath && existingStat.isSymbolicLink()) {
    throw new Error(`Refusing parity setup symlink target: ${targetPath}`);
  }

  const resolvedExistingPath = fs.realpathSync.native(existingPath);
  const resolvedTargetPath = path.join(resolvedExistingPath, ...missingSegments);
  if (!isWithinRoot(sandboxRealPath, resolvedTargetPath)) {
    throw new Error(`Parity setup path escapes temp root: ${targetPath}`);
  }

  return absoluteTargetPath;
}

function prepareSetup(setup, sandboxRoot) {
  return setup.map((entry) => ({
    ...entry,
    path: resolveSandboxPath(entry.path, sandboxRoot)
  }));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function applySetupEntry(entry) {
  if (entry.type === "dir") {
    fs.mkdirSync(entry.path, { recursive: true });
    return;
  }

  if (entry.type === "file" || entry.type === "executable") {
    ensureParent(entry.path);
    fs.writeFileSync(entry.path, entry.content ?? "");

    if (entry.type === "executable" && process.platform !== "win32") {
      fs.chmodSync(entry.path, 0o755);
    }

    return;
  }

  throw new Error(`Unsupported parity setup type: ${entry.type}`);
}

function cleanupSetupEntry(entry) {
  if (!entry?.path || !fs.existsSync(entry.path)) {
    return;
  }

  if (entry.type === "dir") {
    fs.rmSync(entry.path, { recursive: true, force: true });
    return;
  }

  fs.rmSync(entry.path, { force: true });
}

function withSetup(setup, fn) {
  const appliedEntries = [];

  try {
    for (const entry of setup) {
      applySetupEntry(entry);
      appliedEntries.push(entry);
    }

    return fn();
  } finally {
    for (const entry of [...appliedEntries].reverse()) {
      cleanupSetupEntry(entry);
    }
  }
}

function sortById(items) {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeSupportPath(pathSpec) {
  return {
    id: pathSpec.id,
    kind: pathSpec.kind,
    template: pathSpec.template,
    platforms: Array.isArray(pathSpec.platforms) ? sortStrings(pathSpec.platforms) : null,
    description: pathSpec.description ?? null
  };
}

function normalizeSupportLeaf(leaf) {
  return {
    status: leaf.status,
    confidence: leaf.confidence,
    notes: leaf.notes ?? null,
    sources: sortStrings(leaf.sources),
    paths: [...leaf.paths].map(normalizeSupportPath).sort((left, right) => left.id.localeCompare(right.id))
  };
}

function normalizeSupportArea(area) {
  return {
    global: normalizeSupportLeaf(area.global),
    local: normalizeSupportLeaf(area.local)
  };
}

function normalizeSupport(support) {
  return {
    config: normalizeSupportArea(support.config),
    skills: normalizeSupportArea(support.skills),
    commands: normalizeSupportArea(support.commands),
    agents: normalizeSupportArea(support.agents),
    dotAgents: normalizeSupportArea(support.dotAgents)
  };
}

function normalizeSupportRecord(record) {
  return {
    key: record.key,
    name: record.name,
    support: normalizeSupport(record.support)
  };
}

function normalizeSupportList(records) {
  const normalizedRecords = [...records]
    .map((record) => normalizeSupportRecord(record))
    .sort((left, right) => left.key.localeCompare(right.key));

  return {
    count: normalizedRecords.length,
    records: normalizedRecords
  };
}

function normalizeHarnessResult(result, roots) {
  return {
    key: result.key,
    installed: Boolean(result.installed),
    executablePath: normalizePathString(result.executablePath, roots),
    matchedPathIds: sortStrings(result.matchedPaths.map((entry) => entry.id)),
    paths: sortById(result.paths).map((entry) => ({
      id: entry.id,
      path: normalizePathString(entry.path, roots),
      exists: Boolean(entry.exists)
    }))
  };
}

function normalizeDetectResults(results, roots) {
  const normalizedResults = [...results]
    .map((result) => normalizeHarnessResult(result, roots))
    .sort((left, right) => left.key.localeCompare(right.key));

  const installedKeys = normalizedResults
    .filter((result) => result.installed)
    .map((result) => result.key);

  return {
    count: normalizedResults.length,
    installedCount: installedKeys.length,
    installedKeys,
    results: normalizedResults
  };
}

function runCase(rawCase, roots) {
  const testCase = expandCase(rawCase, roots);

  if (Array.isArray(testCase.platforms) && !testCase.platforms.includes(process.platform)) {
    return {
      id: testCase.id,
      operation: testCase.operation,
      skipped: true
    };
  }

  const options = {
    env: testCase.env ?? {},
    cwd: testCase.cwd
  };

  const setup = prepareSetup(Array.isArray(testCase.setup) ? testCase.setup : [], roots.TMP);

  return withSetup(setup, () => {
    if (testCase.operation === "checkHarness") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeHarnessResult(checkHarness(testCase.input, options), roots)
      };
    }

    if (testCase.operation === "detectHarnesses") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeDetectResults(detectHarnesses(options), roots)
      };
    }

    if (testCase.operation === "getHarnessSupport") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeSupportRecord(getHarnessSupport(testCase.input))
      };
    }

    if (testCase.operation === "listHarnessSupport") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeSupportList(listHarnessSupport())
      };
    }

    throw new Error(`Unsupported parity operation: ${testCase.operation}`);
  });
}

function main() {
  const input = parseInput(readInput(process.argv[2]));
  const roots = createSandbox();

  try {
    const output = {
      version: input.version,
      cases: input.cases.map((testCase) => runCase(testCase, roots))
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    fs.rmSync(roots.TMP, { recursive: true, force: true });
  }
}

main();
