import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const sourcePath = path.join(repoRoot, 'packages', 'data', 'harnesses.json');
const targetPaths = [
  path.join(repoRoot, 'packages', 'typescript', 'data', 'harnesses.json'),
  path.join(repoRoot, 'packages', 'golang', 'harnessdetect', 'data', 'harnesses.json'),
  path.join(repoRoot, 'packages', 'rust', 'data', 'harnesses.json'),
  path.join(repoRoot, 'packages', 'python', 'src', 'harness_detect', 'data', 'harnesses.json'),
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const invalidArgs = [...args].filter((arg) => arg !== '--check');
const repoRootRealPath = await realpath(repoRoot);

if (invalidArgs.length > 0) {
  console.error(`Unknown argument(s): ${invalidArgs.join(', ')}`);
  process.exit(2);
}

const relativeToRoot = (filePath) => path.relative(repoRoot, filePath);

function isWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function resolveTargetPath(targetPath) {
  const absoluteTargetPath = path.resolve(targetPath);
  const missingSegments = [];
  let existingPath = absoluteTargetPath;

  while (!(await pathExists(existingPath))) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      throw new Error(`Could not resolve an existing parent for ${targetPath}`);
    }

    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  const resolvedExistingPath = await realpath(existingPath);
  return path.join(resolvedExistingPath, ...missingSegments);
}

async function assertSafeTarget(targetPath) {
  const relativeTargetPath = relativeToRoot(targetPath);

  if (await pathExists(targetPath)) {
    const targetStat = await lstat(targetPath);
    if (targetStat.isSymbolicLink()) {
      throw new Error(`Refusing symlink registry target: ${relativeTargetPath}`);
    }
  }

  const resolvedTargetPath = await resolveTargetPath(targetPath);
  if (!isWithinRoot(repoRootRealPath, resolvedTargetPath)) {
    throw new Error(
      `Refusing registry target outside repo root: ${relativeTargetPath} -> ${resolvedTargetPath}`
    );
  }
}

async function assertSafeSource(sourcePathValue) {
  const relativeSourcePath = relativeToRoot(sourcePathValue);
  const sourceStat = await lstat(sourcePathValue);

  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Refusing symlink registry source: ${relativeSourcePath}`);
  }

  const resolvedSourcePath = await realpath(sourcePathValue);
  if (!isWithinRoot(repoRootRealPath, resolvedSourcePath)) {
    throw new Error(
      `Refusing registry source outside repo root: ${relativeSourcePath} -> ${resolvedSourcePath}`
    );
  }
}

await assertSafeSource(sourcePath);
const sourceBytes = await readFile(sourcePath);
let driftCount = 0;

for (const targetPath of targetPaths) {
  await assertSafeTarget(targetPath);
  const targetBytes = await readFile(targetPath);
  const inSync = sourceBytes.equals(targetBytes);

  if (checkOnly) {
    if (!inSync) {
      driftCount += 1;
      console.error(`Drift detected: ${relativeToRoot(targetPath)}`);
    }

    continue;
  }

  if (inSync) {
    console.log(`Up to date: ${relativeToRoot(targetPath)}`);
    continue;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, sourceBytes);
  console.log(`Synced: ${relativeToRoot(targetPath)}`);
}

if (checkOnly) {
  if (driftCount > 0) {
    process.exit(1);
  }

  console.log('Registry copies are in sync.');
}
