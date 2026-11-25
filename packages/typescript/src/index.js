import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const matrixUrl = new URL("../data/harnesses.json", import.meta.url);
const matrix = JSON.parse(fs.readFileSync(matrixUrl, "utf-8"));

const clone = (value) => {
  if (value === undefined) {
    return;
  }

  return structuredClone(value);
};

const lookupEnv = (env, key) => {
  if (env[key] !== undefined || process.platform !== "win32") {
    return env[key];
  }

  const upperKey = key.toUpperCase();
  let match;

  for (const name of Object.keys(env)) {
    if (
      name.toUpperCase() === upperKey &&
      (match === undefined || name < match)
    ) {
      match = name;
    }
  }

  return match === undefined ? undefined : env[match];
};

const withDefaults = (env = process.env, cwd = process.cwd()) => {
  const userprofile = lookupEnv(env, "USERPROFILE");

  const home =
    lookupEnv(env, "HOME") ||
    (process.platform === "win32" && userprofile) ||
    os.homedir();

  const xdgConfigHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const xdgDataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const xdgStateHome = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  const xdgCacheHome = env.XDG_CACHE_HOME || path.join(home, ".cache");

  return {
    ...env,
    HOME: home,
    USERPROFILE: userprofile || home,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: xdgCacheHome,
    TMPDIR: env.TMPDIR || os.tmpdir(),
    CWD: cwd,
  };
};

const expandLeadingTilde = (value, home) => {
  if (value === "~") {
    return home;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }

  return value;
};

const resolveHarnessRoots = (harness, baseEnv) => {
  const resolved = { ...baseEnv };

  for (const root of harness.roots || []) {
    const envVal = root.env ? lookupEnv(baseEnv, root.env) : undefined;

    // fallbackEnv preserves products that use a legacy override when the
    // preferred override is absent, before applying their static fallback.
    const fallbackEnvVal = root.fallbackEnv
      ? lookupEnv(baseEnv, root.fallbackEnv)
      : undefined;

    let value;

    if (root.env && envVal) {
      if (root.use) {
        // Resolve "use" template against baseEnv + resolved roots + the env var
        const tmp = { ...resolved, [root.env]: envVal };
        value = resolveTemplate(root.use, tmp);
      } else {
        value = envVal;
      }
    } else if (root.fallbackEnv && fallbackEnvVal) {
      value = fallbackEnvVal;
    } else {
      value = resolveTemplate(root.fallback, resolved);
    }

    if (value !== null && value !== "") {
      resolved[root.name] = path.normalize(
        expandLeadingTilde(value, baseEnv.HOME)
      );
    }
  }

  return resolved;
};

const platformMatches = (platforms) =>
  !platforms || platforms.includes(process.platform);

const resolveTemplate = (template, env) => {
  if (!template) {
    return null;
  }

  let unresolved = false;

  const resolved = template.replaceAll(/\$\{(?<name>[^}]+)\}/gu, (_, name) => {
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
};

const pathTypeMatches = (kind, candidatePath) => {
  try {
    const stat = fs.statSync(candidatePath);

    return kind === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
};

const executableFileMatches = (candidatePath) => {
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
};

const resolvePaths = (harness, env) =>
  harness.paths
    .filter((entry) => platformMatches(entry.platforms))
    .map((entry) => {
      const resolved = resolveTemplate(entry.template, env);
      const exists = resolved ? pathTypeMatches(entry.kind, resolved) : false;

      const result = { ...entry, path: resolved, exists };

      if (entry.platforms !== undefined) {
        result.platforms = [...entry.platforms];
      }

      return result;
    });

// With absoluteOnly, relative PATH entries are ignored.
const findExecutable = (executables, env, absoluteOnly = false) => {
  if (!executables.length) {
    return null;
  }

  const pathValue = env.PATH || "";

  const pathParts = pathValue
    .split(path.delimiter)
    .filter((dir) => dir && (!absoluteOnly || path.isAbsolute(dir)));

  const exts =
    process.platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const executable of executables) {
    for (const dir of pathParts) {
      for (const ext of exts) {
        const candidate = path.join(
          dir,
          process.platform === "win32" ? `${executable}${ext}` : executable
        );

        if (executableFileMatches(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
};

const normalizeKey = (input) => String(input).trim().toLowerCase();

const getHarnessDefinition = (input) => {
  const key = normalizeKey(input);

  return (
    matrix.harnesses.find((harness) => {
      if (normalizeKey(harness.key) === key) {
        return true;
      }

      return (harness.aliases || []).some(
        (alias) => normalizeKey(alias) === key
      );
    }) || null
  );
};

const cloneHarnessSupportRecord = (harness) => ({
  key: harness.key,
  name: harness.name,
  support: clone(harness.support),
});

export const getHarnessMatrix = () => getRawHarnessData();

export const getRawHarnessData = () => clone(matrix);

export const listHarnesses = () => clone(matrix.harnesses);

export const getHarnessSupport = (input) => {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  return cloneHarnessSupportRecord(harness);
};

export const listHarnessSupport = () =>
  matrix.harnesses.map(cloneHarnessSupportRecord);

const cloneHarnessAcpRecord = (harness) => ({
  key: harness.key,
  name: harness.name,
  acp: clone(
    harness.acp ?? { status: "unknown", sources: [], confidence: "unknown" }
  ),
});

export const getHarnessAcp = (input) => {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  return cloneHarnessAcpRecord(harness);
};

export const listHarnessAcp = () => matrix.harnesses.map(cloneHarnessAcpRecord);

const cloneHarnessMcpRecord = (harness) => ({
  key: harness.key,
  mcp: clone(harness.mcp),
  name: harness.name,
});

export const getHarnessMcp = (input) => {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  return cloneHarnessMcpRecord(harness);
};

export const listHarnessMcp = () => matrix.harnesses.map(cloneHarnessMcpRecord);

const MCP_TRANSPORTS = new Set(["stdio", "http", "sse"]);

const isPlainObject = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  value !== null && typeof value === "object" && !Array.isArray(value);

const isStringMap = (value) =>
  isPlainObject(value) &&
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  Object.values(value).every((entry) => typeof entry === "string");

const resolveMcpTransport = (server) => {
  if (server.type === undefined) {
    if ("command" in server) {
      return "stdio";
    }

    return "url" in server ? "http" : { reason: "missing command or url" };
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  if (typeof server.type !== "string") {
    return { reason: "invalid server entry" };
  }

  if (!MCP_TRANSPORTS.has(server.type)) {
    return { reason: `unsupported transport: ${server.type}` };
  }

  return server.type;
};

const translateMcpStdio = (entry, server, target) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  if (typeof server.command !== "string" || server.command === "") {
    return "missing command";
  }

  const args = server.args ?? [];

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    return "invalid args";
  }

  const env = server.env ?? {};

  if (!isStringMap(env)) {
    return "invalid env";
  }

  if (target.commandFormat === "shlex") {
    entry[target.command] = [server.command, ...args]
      .map((word) => `'${word.replaceAll("'", "'\"'\"'")}'`)
      .join(" ");

    if (target.args !== undefined) {
      entry[target.args] = [];
    }
  } else if (target.args === undefined) {
    entry[target.command] = [server.command, ...args];
  } else {
    entry[target.command] = server.command;
    entry[target.args] = [...args];
  }

  if (Object.keys(env).length > 0) {
    if (target.env === undefined) {
      return "env not supported";
    }

    entry[target.env] = { ...env };
  }

  return entry;
};

const translateMcpRemote = (entry, server, target) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  if (typeof server.url !== "string" || server.url === "") {
    return "missing url";
  }

  const headers = server.headers ?? {};

  if (!isStringMap(headers)) {
    return "invalid headers";
  }

  entry[target.url] = server.url;

  if (Object.keys(headers).length > 0) {
    if (target.headers === undefined) {
      return "headers not supported";
    }

    entry[target.headers] = { ...headers };
  }

  return entry;
};

// Returns a native entry, or a string reason when the server cannot be
// translated. The check order matches every package.
const translateMcpServer = (name, server, format) => {
  if (!isPlainObject(server)) {
    return "invalid server entry";
  }

  const transport = resolveMcpTransport(server);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  if (typeof transport !== "string") {
    return transport.reason;
  }

  const target = format[transport];

  if (!target) {
    return `unsupported transport: ${transport}`;
  }

  const entry = { ...format.defaults };

  if (format.nameField !== undefined) {
    entry[format.nameField] = name;
  }

  if (target.type !== undefined) {
    entry[format.typeField] = target.type;
  }

  return transport === "stdio"
    ? translateMcpStdio(entry, server, target)
    : translateMcpRemote(entry, server, target);
};

/**
 * Translates a project .mcp.json document ({"mcpServers": {...}}) into the
 * native MCP config of a harness for one scope. Pure: nothing is read or
 * written. Servers the native format cannot represent are listed in skipped.
 */
export const translateMcpJson = (input, mcpJson, options = {}) => {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  const scope = options.scope ?? "local";

  if (scope !== "global" && scope !== "local") {
    throw new Error(`Unknown MCP scope: ${scope}`);
  }

  const { mcp } = harness;
  const leaf = mcp[scope];
  const format = mcp.serverFormat;

  if (
    mcp.status !== "supported" ||
    leaf.status !== "supported" ||
    leaf.format === undefined ||
    format === undefined
  ) {
    throw new Error(
      `Harness ${harness.key} has no file-based MCP config for scope ${scope}`
    );
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
  const document = typeof mcpJson === "string" ? JSON.parse(mcpJson) : mcpJson;

  if (!isPlainObject(document) || !isPlainObject(document.mcpServers)) {
    throw new Error(".mcp.json must be an object with an mcpServers object");
  }

  const mapped = [];
  const entries = [];
  const skipped = [];

  // oxlint-disable-next-line unicorn/no-array-sort -- engines allows Node 18, which lacks toSorted
  for (const name of Object.keys(document.mcpServers).sort()) {
    const result = translateMcpServer(name, document.mcpServers[name], format);

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates untrusted .mcp.json input at the entry boundary
    if (typeof result === "string") {
      skipped.push({ name, reason: result });
    } else if (format.container === "array") {
      entries.push(result);
    } else {
      mapped.push([name, result]);
    }
  }

  // fromEntries defines own properties, so a server named "__proto__" stays data.
  const servers =
    format.container === "array" ? entries : Object.fromEntries(mapped);

  let config = servers;

  for (let index = leaf.keyPath.length - 1; index >= 0; index -= 1) {
    config = { [leaf.keyPath[index]]: config };
  }

  return {
    config: clone(config),
    format: leaf.format,
    key: harness.key,
    keyPath: [...leaf.keyPath],
    name: harness.name,
    scope,
    servers,
    skipped,
  };
};

export const checkHarness = (input, options = {}) => {
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
    reasons,
  };
};

/**
 * Resolves a registry path template, such as a support or MCP path, for one
 * harness, using the same base variables and harness roots as checkHarness.
 * Returns null when a placeholder cannot be resolved. Nothing is checked on
 * disk.
 */
export const resolveHarnessTemplate = (input, template, options = {}) => {
  const harness = getHarnessDefinition(input);

  if (!harness) {
    throw new Error(`Unknown harness: ${input}`);
  }

  const env = resolveHarnessRoots(
    harness,
    withDefaults(options.env, options.cwd)
  );

  return resolveTemplate(template, env);
};

export const detectHarnesses = (options = {}) =>
  matrix.harnesses.map((harness) => checkHarness(harness.key, options));

export const detectInstalledHarnesses = (options = {}) =>
  detectHarnesses(options).filter((result) => result.installed);

const isPackageRunner = ({ command, args }) =>
  ["npx", "bunx", "uvx"].includes(command) ||
  (command === "pnpm" && args[0] === "dlx");

/**
 * Lists ACP agents that can be started from binaries already installed: the
 * ACP status is supported, the entry does not delegate to an adapter, and the
 * command of its launch for this platform resolves to an absolute executable.
 * Uses installedLaunches when present, otherwise launches that do not use a
 * package runner. Nothing is executed.
 */
export const detectInstalledAcpLaunches = (options = {}) => {
  const env = withDefaults(options.env, options.cwd);
  const results = [];

  for (const harness of matrix.harnesses) {
    const { acp } = harness;

    if (acp?.status !== "supported" || acp.adapter !== undefined) {
      continue;
    }

    const launches =
      acp.installedLaunches ??
      acp.launches.filter((launch) => !isPackageRunner(launch));

    const launch = launches.find((entry) => platformMatches(entry.platforms));
    const command = launch && findExecutable([launch.command], env, true);

    if (command) {
      results.push({
        key: harness.key,
        name: harness.name,
        command,
        args: [...launch.args],
      });
    }
  }

  return results;
};
