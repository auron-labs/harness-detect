export type HarnessPathCategory = "install" | "config" | "state" | "cache" | "project";
export type HarnessSupportArea = "config" | "skills" | "commands" | "agents" | "agentsSkills";
export type HarnessSupportScope = "global" | "local";
export type HarnessSupportStatus = "supported" | "unsupported" | "unknown";
export type HarnessSupportConfidence = "official" | "source" | "observed" | "inferred" | "unknown";
export type HarnessPlatform = "aix" | "android" | "cygwin" | "darwin" | "freebsd" | "haiku" | "linux" | "netbsd" | "openbsd" | "sunos" | "win32";

export interface HarnessEnvVar {
  name: string;
  description: string;
}

export interface HarnessPathSpec {
  id: string;
  category: HarnessPathCategory;
  kind: "file" | "dir";
  template: string;
  platforms?: HarnessPlatform[];
}

export interface HarnessSupportPath {
  id: string;
  kind: "file" | "dir";
  template: string;
  platforms?: HarnessPlatform[];
  description?: string;
}

export interface HarnessSupportLeaf {
  status: HarnessSupportStatus;
  paths: HarnessSupportPath[];
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
}

export type HarnessSupport = Record<HarnessSupportArea, Record<HarnessSupportScope, HarnessSupportLeaf>>;

export interface HarnessAcpLaunch {
  command: string;
  args: string[];
  platforms?: HarnessPlatform[];
}

export type HarnessAcp = {
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
} & (
  | {
      status: "supported";
      launches: [HarnessAcpLaunch, ...HarnessAcpLaunch[]];
      installedLaunches?: [HarnessAcpLaunch, ...HarnessAcpLaunch[]];
      adapter?: never;
    }
  | { status: "supported"; adapter: string; launches?: never; installedLaunches?: never }
  | { status: "unsupported" | "unknown"; launches?: never; installedLaunches?: never; adapter?: never }
);

export interface HarnessAcpRecord {
  key: string;
  name: string;
  acp: HarnessAcp;
}

export interface InstalledAcpLaunch {
  key: string;
  name: string;
  /** Absolute path of the resolved executable. */
  command: string;
  args: string[];
}

export type McpConfigFormat = "json" | "jsonc" | "toml" | "yaml";
export type McpScope = "global" | "local";

export interface HarnessMcpScope {
  status: HarnessSupportStatus;
  /** Config files (or directories of config files) that hold MCP servers for this scope. */
  paths: HarnessSupportPath[];
  /** Present when status is supported and paths is non-empty. */
  format?: McpConfigFormat;
  /** Key segments under which servers are stored, outermost first. */
  keyPath?: [string, ...string[]];
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
}

export interface HarnessMcpStdioFormat {
  type?: string;
  command: string;
  /** When omitted, the command field holds an argv array [command, ...args]. */
  args?: string;
  /** When omitted, servers that set env cannot be translated. */
  env?: string;
}

export interface HarnessMcpRemoteFormat {
  type?: string;
  url: string;
  /** When omitted, servers that set headers cannot be translated. */
  headers?: string;
}

export interface HarnessMcpServerFormat {
  container: "map" | "array";
  nameField?: string;
  typeField?: string;
  stdio: HarnessMcpStdioFormat;
  http?: HarnessMcpRemoteFormat;
  sse?: HarnessMcpRemoteFormat;
  defaults?: Record<string, string | number | boolean>;
}

export interface HarnessMcp {
  /** Whether the harness can use MCP servers. */
  status: HarnessSupportStatus;
  /** Whether the harness natively reads the project-root .mcp.json. */
  mcpJson: HarnessSupportStatus;
  global: HarnessMcpScope;
  local: HarnessMcpScope;
  serverFormat?: HarnessMcpServerFormat;
  sources: string[];
  confidence: HarnessSupportConfidence;
  notes?: string;
}

export interface HarnessMcpRecord {
  key: string;
  name: string;
  mcp: HarnessMcp;
}

/** A server as written in a project .mcp.json file. */
export interface McpJsonServer {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  [field: string]: unknown;
}

export interface McpJsonDocument {
  mcpServers: Record<string, McpJsonServer>;
  [field: string]: unknown;
}

export interface TranslateMcpJsonOptions {
  /** Defaults to "local". */
  scope?: McpScope;
}

export interface McpSkippedServer {
  name: string;
  reason: string;
}

export interface McpTranslation {
  key: string;
  name: string;
  scope: McpScope;
  format: McpConfigFormat;
  keyPath: [string, ...string[]];
  /** Native servers: an object keyed by name, or an array for array containers. */
  servers: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  /** servers nested under keyPath, ready to merge into the native config file. */
  config: Record<string, unknown>;
  skipped: McpSkippedServer[];
}

export interface HarnessRootDef {
  name: string;
  env?: string;
  use?: string;
  fallbackEnv?: string;
  fallback: string;
}

export type HarnessInstallMethod =
  | "npm"
  | "homebrew"
  | "pip"
  | "pipx"
  | "uv"
  | "cargo"
  | "go"
  | "script"
  | "manual"
  | "marketplace"
  | "binary"
  | "unknown";

export interface HarnessInstallation {
  method: HarnessInstallMethod;
  package?: string;
  command?: string;
  url?: string;
  marketplace?: string;
  id?: string;
  platforms?: HarnessPlatform[];
  notes?: string;
}

export interface HarnessDefinition {
  key: string;
  name: string;
  /** Upstream version the entry was last verified against, or "unknown". */
  version: string;
  aliases: string[];
  executables: string[];
  installations: HarnessInstallation[];
  paths: HarnessPathSpec[];
  roots?: HarnessRootDef[];
  support: HarnessSupport;
  acp?: HarnessAcp;
  mcp: HarnessMcp;
  env: HarnessEnvVar[];
  sources: string[];
}

export interface HarnessMatrix {
  version: number;
  harnesses: HarnessDefinition[];
}

export interface ResolvedHarnessPath extends HarnessPathSpec {
  path: string | null;
  exists: boolean;
}

export interface CheckHarnessOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface HarnessCheckResult {
  key: string;
  name: string;
  installed: boolean;
  executablePath: string | null;
  harness: HarnessDefinition;
  paths: ResolvedHarnessPath[];
  matchedPaths: ResolvedHarnessPath[];
  reasons: string[];
}

export interface HarnessSupportRecord {
  key: string;
  name: string;
  support: HarnessSupport;
}

export declare function getRawHarnessData(): HarnessMatrix;
export declare function getHarnessMatrix(): HarnessMatrix;
export declare function listHarnesses(): HarnessDefinition[];
export declare function getHarnessAcp(input: string): HarnessAcpRecord;
export declare function listHarnessAcp(): HarnessAcpRecord[];
export declare function getHarnessMcp(input: string): HarnessMcpRecord;
export declare function listHarnessMcp(): HarnessMcpRecord[];
export declare function translateMcpJson(input: string, mcpJson: McpJsonDocument | string, options?: TranslateMcpJsonOptions): McpTranslation;
export declare function getHarnessSupport(input: string): HarnessSupportRecord;
export declare function listHarnessSupport(): HarnessSupportRecord[];
export declare function checkHarness(input: string, options?: CheckHarnessOptions): HarnessCheckResult;
export declare function detectHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[];
export declare function detectInstalledHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[];
export declare function detectInstalledAcpLaunches(options?: CheckHarnessOptions): InstalledAcpLaunch[];
