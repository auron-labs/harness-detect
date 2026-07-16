export type HarnessPathCategory = "install" | "config" | "state" | "cache" | "project";
export type HarnessSupportArea = "config" | "skills" | "commands" | "agents" | "dotAgents";
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

export interface HarnessRootDef {
  name: string;
  env?: string;
  use?: string;
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
  aliases: string[];
  executables: string[];
  installations: HarnessInstallation[];
  paths: HarnessPathSpec[];
  roots?: HarnessRootDef[];
  support: HarnessSupport;
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
export declare function getHarnessSupport(input: string): HarnessSupportRecord;
export declare function listHarnessSupport(): HarnessSupportRecord[];
export declare function checkHarness(input: string, options?: CheckHarnessOptions): HarnessCheckResult;
export declare function detectHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[];
export declare function detectInstalledHarnesses(options?: CheckHarnessOptions): HarnessCheckResult[];
