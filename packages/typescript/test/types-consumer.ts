import { checkHarness, detectHarnesses, detectInstalledHarnesses, getHarnessMatrix, getRawHarnessData, listHarnesses, type HarnessPlatform } from "@auron-labs/harness-detect";

type Assert<T extends true> = T;
type IsExact<T, U> =
  (<G>() => G extends T ? 1 : 2) extends (<G>() => G extends U ? 1 : 2)
    ? ((<G>() => G extends U ? 1 : 2) extends (<G>() => G extends T ? 1 : 2) ? true : false)
    : false;

const matrix = getHarnessMatrix();
const rawMatrix = getRawHarnessData();
const version: number = matrix.version;
const rawVersion: number = rawMatrix.version;
const harnesses = listHarnesses();
const firstHarnessName: string = harnesses[0]?.name ?? "";

const checkResult = checkHarness("codex", {
  cwd: "/repo",
  env: {
    HOME: "/tmp/home",
    PATH: ""
  }
});

const detected = detectHarnesses({
  cwd: "/repo",
  env: {
    HOME: "/tmp/home",
    PATH: ""
  }
});

const detectedInstalled = detectInstalledHarnesses({
  cwd: "/repo",
  env: {
    HOME: "/tmp/home",
    PATH: ""
  }
});

const checkResultKey: string = checkResult.key;
const checkResultName: string = checkResult.name;
const installed: boolean = checkResult.installed;
const executablePath: string | null = checkResult.executablePath;
const firstResolvedPath = checkResult.paths[0]!;
const resolvedPathValue: string | null = firstResolvedPath.path;
const resolvedPathExists: boolean = firstResolvedPath.exists;
const matchedPathId: string | undefined = checkResult.matchedPaths[0]?.id;
const reason: string | undefined = checkResult.reasons[0];
const harnessAliases: string[] = checkResult.harness.aliases;
const harnessOptionalRoots = checkResult.harness.roots;
const firstInstallation = checkResult.harness.installations[0];
const firstInstallationMethod = firstInstallation?.method;
const firstInstallationPackage = firstInstallation?.package;
const firstInstallationMarketplace = firstInstallation?.marketplace;
const firstInstallationId = firstInstallation?.id;
const firstInstallationPlatforms: HarnessPlatform[] | undefined = firstInstallation?.platforms;
const harnessMatrixInstallationUrl = matrix.harnesses[0]?.installations[0]?.url;
const firstResolvedPathPlatforms: HarnessPlatform[] | undefined = firstResolvedPath.platforms;
const linuxPlatform: HarnessPlatform = "linux";
const firstDetectedKey: string | undefined = detected[0]?.key;
const firstInstalledDetectedKey: string | undefined = detectedInstalled[0]?.key;

type _CheckResultExecutablePathIsNullable = Assert<IsExact<typeof checkResult.executablePath, string | null>>;
type _ResolvedPathPathIsNullable = Assert<IsExact<typeof firstResolvedPath.path, string | null>>;
type _HarnessRootsStayOptional = Assert<IsExact<typeof checkResult.harness.roots, { name: string; env?: string; use?: string; fallback: string }[] | undefined>>;

void version;
void rawVersion;
void firstHarnessName;
void checkResultKey;
void checkResultName;
void installed;
void executablePath;
void resolvedPathValue;
void resolvedPathExists;
void matchedPathId;
void reason;
void harnessAliases;
void harnessOptionalRoots;
void firstInstallationMethod;
void firstInstallationPackage;
void firstInstallationMarketplace;
void firstInstallationId;
void firstInstallationPlatforms;
void harnessMatrixInstallationUrl;
void firstResolvedPathPlatforms;
void linuxPlatform;
void firstDetectedKey;
void firstInstalledDetectedKey;
