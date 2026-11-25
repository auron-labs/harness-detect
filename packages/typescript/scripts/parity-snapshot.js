import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkHarness,
  detectHarnesses,
  detectInstalledAcpLaunches,
  detectInstalledHarnesses,
  getHarnessAcp,
  getHarnessMatrix,
  getHarnessMcp,
  getHarnessSupport,
  getRawHarnessData,
  listHarnessAcp,
  listHarnessMcp,
  listHarnessSupport,
  listHarnesses,
  resolveHarnessTemplate,
  translateMcpJson,
} from "../src/index.js";

const readInput = (sourceArg) => {
  if (sourceArg && sourceArg !== "-") {
    const sourcePath = path.resolve(process.cwd(), sourceArg);

    return fs.readFileSync(sourcePath, "utf-8");
  }

  return fs.readFileSync(0, "utf-8");
};

const parseInput = (raw) => {
  if (!raw.trim()) {
    throw new Error(
      "Expected JSON parity cases from stdin or a file path argument."
    );
  }

  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;

  if (!Array.isArray(cases)) {
    throw new TypeError(
      "Parity input must be an array of cases or an object with a cases array."
    );
  }

  return {
    version: Array.isArray(parsed) ? null : (parsed.version ?? null),
    cases,
  };
};

const createSandbox = () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "harness-detect-parity-")
  );

  const roots = {
    TMP: tempRoot,
    HOME: path.join(tempRoot, "home"),
    CWD: path.join(tempRoot, "cwd"),
    BIN: path.join(tempRoot, "bin"),
  };

  for (const dirPath of Object.values(roots)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return roots;
};

const expandString = (value, roots) =>
  value.replaceAll(/\$\{(?<key>TMP|HOME|CWD|BIN)\}/gu, (_, key) => roots[key]);

const expandValue = (value, roots) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted JSON from parity case files at the entry boundary
  if (typeof value === "string") {
    return expandString(value, roots);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => expandValue(entry, roots));
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted JSON from parity case files at the entry boundary
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        expandValue(entry, roots),
      ])
    );
  }

  return value;
};

const expandCase = (testCase, roots) => {
  const expanded = { id: testCase.id, operation: testCase.operation };

  for (const field of ["input", "platforms", "cwd", "env", "setup"]) {
    if (testCase[field] !== undefined) {
      expanded[field] = expandValue(testCase[field], roots);
    }
  }

  // Registry templates and .mcp.json documents are passed through unexpanded.
  for (const field of ["template", "scope", "mcpJson"]) {
    if (testCase[field] !== undefined) {
      expanded[field] = testCase[field];
    }
  }

  return expanded;
};

const normalizePathString = (value, roots) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted JSON from parity case files at the entry boundary
  if (typeof value !== "string") {
    return value ?? null;
  }

  const replacements = Object.entries(roots)
    .map(([key, rootPath]) => [key, path.resolve(rootPath)])
    .toSorted((left, right) => right[1].length - left[1].length);

  let normalized = path.resolve(value);

  for (const [key, rootPath] of replacements) {
    if (
      normalized === rootPath ||
      normalized.startsWith(`${rootPath}${path.sep}`)
    ) {
      normalized = `\${${key}}${normalized.slice(rootPath.length)}`;
      break;
    }
  }

  return normalized;
};

const isWithinRoot = (rootPath, candidatePath) => {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const resolveSandboxPath = (targetPath, sandboxRoot) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted JSON from parity case files at the entry boundary
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new Error("Parity setup entries must include a non-empty path.");
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted JSON from parity case files at the entry boundary
  if (typeof sandboxRoot !== "string" || sandboxRoot.length === 0) {
    throw new Error(
      `Parity setup path requires a tempRoot sandbox: ${targetPath}`
    );
  }

  const sandboxRealPath = fs.realpathSync.native(sandboxRoot);
  const absoluteTargetPath = path.resolve(targetPath);
  const missingSegments = [];
  let existingPath = absoluteTargetPath;

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);

    if (parentPath === existingPath) {
      throw new Error(
        `Could not resolve a parity setup parent for ${targetPath}`
      );
    }

    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  const existingStat = fs.lstatSync(existingPath);

  if (existingPath === absoluteTargetPath && existingStat.isSymbolicLink()) {
    throw new Error(`Refusing parity setup symlink target: ${targetPath}`);
  }

  const resolvedExistingPath = fs.realpathSync.native(existingPath);

  const resolvedTargetPath = path.join(
    resolvedExistingPath,
    ...missingSegments
  );

  if (!isWithinRoot(sandboxRealPath, resolvedTargetPath)) {
    throw new Error(`Parity setup path escapes temp root: ${targetPath}`);
  }

  return absoluteTargetPath;
};

const prepareSetup = (setup, sandboxRoot) =>
  setup.map((entry) => ({
    ...entry,
    path: resolveSandboxPath(entry.path, sandboxRoot),
  }));

const ensureParent = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const applySetupEntry = (entry) => {
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
};

const cleanupSetupEntry = (entry) => {
  if (!entry?.path || !fs.existsSync(entry.path)) {
    return;
  }

  if (entry.type === "dir") {
    fs.rmSync(entry.path, { recursive: true, force: true });

    return;
  }

  fs.rmSync(entry.path, { force: true });
};

const withSetup = (setup, fn) => {
  const appliedEntries = [];

  try {
    for (const entry of setup) {
      applySetupEntry(entry);
      appliedEntries.push(entry);
    }

    return fn();
  } finally {
    for (const entry of [...appliedEntries].toReversed()) {
      cleanupSetupEntry(entry);
    }
  }
};

const sortById = (items) =>
  items.toSorted((left, right) => left.id.localeCompare(right.id));

const sortStrings = (values) =>
  values.toSorted((left, right) => left.localeCompare(right));

const normalizeSupportPath = (pathSpec) => ({
  id: pathSpec.id,
  kind: pathSpec.kind,
  template: pathSpec.template,
  platforms: Array.isArray(pathSpec.platforms)
    ? sortStrings(pathSpec.platforms)
    : null,
  description: pathSpec.description ?? null,
});

const normalizeSupportLeaf = (leaf) => ({
  status: leaf.status,
  confidence: leaf.confidence,
  notes: leaf.notes ?? null,
  sources: sortStrings(leaf.sources),
  paths: leaf.paths
    .map(normalizeSupportPath)
    .toSorted((left, right) => left.id.localeCompare(right.id)),
});

const normalizeSupportArea = (area) => ({
  global: normalizeSupportLeaf(area.global),
  local: normalizeSupportLeaf(area.local),
});

const normalizeSupport = (support) => ({
  config: normalizeSupportArea(support.config),
  skills: normalizeSupportArea(support.skills),
  commands: normalizeSupportArea(support.commands),
  agents: normalizeSupportArea(support.agents),
  agentsSkills: normalizeSupportArea(support.agentsSkills),
});

const normalizeSupportRecord = (record) => ({
  key: record.key,
  name: record.name,
  support: normalizeSupport(record.support),
});

const normalizeSupportList = (records) => {
  const normalizedRecords = [...records]
    .map((record) => normalizeSupportRecord(record))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  return {
    count: normalizedRecords.length,
    records: normalizedRecords,
  };
};

const normalizeHarnessResult = (result, roots) => ({
  key: result.key,
  installed: Boolean(result.installed),
  executablePath: normalizePathString(result.executablePath, roots),
  matchedPathIds: sortStrings(result.matchedPaths.map((entry) => entry.id)),
  paths: sortById(result.paths).map((entry) => ({
    id: entry.id,
    path: normalizePathString(entry.path, roots),
    exists: Boolean(entry.exists),
  })),
});

const normalizeDetectResults = (results, roots) => {
  const normalizedResults = [...results]
    .map((result) => normalizeHarnessResult(result, roots))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const installedKeys = normalizedResults.flatMap((result) =>
    result.installed ? [result.key] : []
  );

  return {
    count: normalizedResults.length,
    installedCount: installedKeys.length,
    installedKeys,
    results: normalizedResults,
  };
};

const errorResult = (fn) => {
  try {
    return fn();
  } catch (error) {
    return { error: error.message };
  }
};

const snapshotTranslation = (testCase) => {
  const translate = (harness, scope) =>
    errorResult(() => {
      const result = translateMcpJson(
        harness,
        testCase.mcpJson,
        scope === undefined ? {} : { scope }
      );

      return {
        key: result.key,
        name: result.name,
        scope: result.scope,
        format: result.format,
        keyPath: result.keyPath,
        servers: result.servers,
        config: result.config,
        skipped: result.skipped,
      };
    });

  if (testCase.input !== "*") {
    return translate(testCase.input, testCase.scope);
  }

  // Every harness and scope, so each registry serverFormat is exercised.
  return Object.fromEntries(
    listHarnesses()
      .map((harness) => harness.key)
      .toSorted()
      .map((key) => [
        key,
        { global: translate(key, "global"), local: translate(key, "local") },
      ])
  );
};

const runCase = (rawCase, roots) => {
  const testCase = expandCase(rawCase, roots);

  if (
    Array.isArray(testCase.platforms) &&
    !testCase.platforms.includes(process.platform)
  ) {
    return {
      id: testCase.id,
      operation: testCase.operation,
      skipped: true,
    };
  }

  const options = {
    env: testCase.env ?? {},
    cwd: testCase.cwd,
  };

  const setup = prepareSetup(
    Array.isArray(testCase.setup) ? testCase.setup : [],
    roots.TMP
  );

  return withSetup(setup, () => {
    if (testCase.operation === "checkHarness") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeHarnessResult(
          checkHarness(testCase.input, options),
          roots
        ),
      };
    }

    if (testCase.operation === "detectHarnesses") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeDetectResults(detectHarnesses(options), roots),
      };
    }

    if (
      testCase.operation === "getHarnessAcp" ||
      testCase.operation === "listHarnessAcp"
    ) {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result:
          testCase.operation === "getHarnessAcp"
            ? getHarnessAcp(testCase.input)
            : listHarnessAcp(),
      };
    }

    if (testCase.operation === "detectInstalledAcpLaunches") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: {
          launches: detectInstalledAcpLaunches(options).map((launch) => ({
            key: launch.key,
            command: normalizePathString(launch.command, roots),
            args: launch.args,
          })),
        },
      };
    }

    if (testCase.operation === "detectInstalledHarnesses") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeDetectResults(
          detectInstalledHarnesses(options),
          roots
        ),
      };
    }

    if (
      testCase.operation === "getRawHarnessData" ||
      testCase.operation === "getHarnessMatrix"
    ) {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result:
          testCase.operation === "getRawHarnessData"
            ? getRawHarnessData()
            : getHarnessMatrix(),
      };
    }

    if (testCase.operation === "listHarnesses") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: listHarnesses(),
      };
    }

    if (testCase.operation === "getHarnessMcp") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: errorResult(() => getHarnessMcp(testCase.input)),
      };
    }

    if (testCase.operation === "listHarnessMcp") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: listHarnessMcp(),
      };
    }

    if (testCase.operation === "translateMcpJson") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: snapshotTranslation(testCase),
      };
    }

    if (testCase.operation === "resolveHarnessTemplate") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: errorResult(() => ({
          path: normalizePathString(
            resolveHarnessTemplate(testCase.input, testCase.template, options),
            roots
          ),
        })),
      };
    }

    if (testCase.operation === "getHarnessSupport") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeSupportRecord(getHarnessSupport(testCase.input)),
      };
    }

    if (testCase.operation === "listHarnessSupport") {
      return {
        id: testCase.id,
        operation: testCase.operation,
        result: normalizeSupportList(listHarnessSupport()),
      };
    }

    throw new Error(`Unsupported parity operation: ${testCase.operation}`);
  });
};

const main = () => {
  const input = parseInput(readInput(process.argv[2]));
  const roots = createSandbox();

  try {
    const output = {
      version: input.version,
      cases: input.cases.map((testCase) => runCase(testCase, roots)),
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    fs.rmSync(roots.TMP, { recursive: true, force: true });
  }
};

main();
