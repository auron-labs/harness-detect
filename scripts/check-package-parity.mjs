import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultFixturePath = path.join(repoRoot, 'testdata', 'package-parity-cases.json');
const apiManifestPath = path.join(repoRoot, 'testdata', 'public-api-parity.json');
const canonicalRegistryPath = path.join(repoRoot, 'packages', 'data', 'harnesses.json');
const tsHelperPath = path.join(repoRoot, 'packages', 'typescript', 'scripts', 'parity-snapshot.js');
const goPackageDir = path.join(repoRoot, 'packages', 'golang');
const rustPackageDir = path.join(repoRoot, 'packages', 'rust');
const pythonPackageDir = path.join(repoRoot, 'packages', 'python');
const pythonCommand = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const forceMismatchPath = process.env.HARNESS_DETECT_PARITY_FORCE_MISMATCH ?? '';

function parseArgs(argv) {
  const args = argv.slice(2);
  const fixtureArgs = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    fixtureArgs.push(arg);
  }

  if (fixtureArgs.length > 1) {
    throw new Error('Expected at most one optional fixture file path argument.');
  }

  return {
    fixturePath: fixtureArgs[0] ? path.resolve(process.cwd(), fixtureArgs[0]) : defaultFixturePath
  };
}

function readFixtureFile(fixturePath) {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  if (!Array.isArray(raw.cases)) {
    throw new Error(`Fixture file must contain a cases array: ${fixturePath}`);
  }

  return raw;
}

function runSnapshot(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    // Snapshots embed the full registry several times.
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(options.env ?? {}) }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const detail = [stderr, stdout].filter(Boolean).join('\n');
    throw new Error(`${options.label} exited ${result.status}${detail ? `\n${detail}` : ''}`);
  }

  return JSON.parse(result.stdout);
}

function maybeForceMismatch(snapshot) {
  if (!forceMismatchPath) {
    return snapshot;
  }

  const clone = JSON.parse(JSON.stringify(snapshot));
  const segments = forceMismatchPath.split('.').filter(Boolean);

  if (segments.length === 0) {
    throw new Error('HARNESS_DETECT_PARITY_FORCE_MISMATCH must name a JSON path such as cases.0.result.installed');
  }

  let cursor = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = /^\d+$/.test(segments[index]) ? Number(segments[index]) : segments[index];
    if (!(key in cursor)) {
      throw new Error(`Cannot force mismatch at missing path segment: ${segments[index]}`);
    }
    cursor = cursor[key];
  }

  const lastSegment = segments.at(-1);
  const lastKey = /^\d+$/.test(lastSegment) ? Number(lastSegment) : lastSegment;
  if (!(lastKey in cursor)) {
    throw new Error(`Cannot force mismatch at missing path: ${forceMismatchPath}`);
  }

  cursor[lastKey] = `__forced_mismatch__:${String(cursor[lastKey])}`;
  return clone;
}

function formatValue(value) {
  return JSON.stringify(value);
}

function compareValues(left, right, fieldPath, diffs) {
  if (Object.is(left, right)) {
    return;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      diffs.push({ fieldPath, left, right });
      return;
    }

    if (left.length !== right.length) {
      diffs.push({ fieldPath: `${fieldPath}.length`, left: left.length, right: right.length });
      return;
    }

    for (let index = 0; index < left.length; index += 1) {
      compareValues(left[index], right[index], `${fieldPath}[${index}]`, diffs);
      if (diffs.length >= 12) {
        return;
      }
    }

    return;
  }

  const leftIsObject = left && typeof left === 'object';
  const rightIsObject = right && typeof right === 'object';
  if (leftIsObject || rightIsObject) {
    if (!leftIsObject || !rightIsObject) {
      diffs.push({ fieldPath, left, right });
      return;
    }

    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      compareValues(left[key], right[key], `${fieldPath}.${key}`, diffs);
      if (diffs.length >= 12) {
        return;
      }
    }

    return;
  }

  diffs.push({ fieldPath, left, right });
}

function compareSnapshots(referenceSnapshot, candidateSnapshot) {
  const diffs = [];

  if (!Object.is(referenceSnapshot.version, candidateSnapshot.version)) {
    diffs.push({ caseId: '<snapshot>', fieldPath: 'version', left: referenceSnapshot.version, right: candidateSnapshot.version });
  }

  const referenceCases = Array.isArray(referenceSnapshot.cases) ? referenceSnapshot.cases : [];
  const candidateCases = Array.isArray(candidateSnapshot.cases) ? candidateSnapshot.cases : [];

  if (referenceCases.length !== candidateCases.length) {
    diffs.push({ caseId: '<snapshot>', fieldPath: 'cases.length', left: referenceCases.length, right: candidateCases.length });
    return diffs;
  }

  for (let index = 0; index < referenceCases.length; index += 1) {
    const referenceCase = referenceCases[index];
    const candidateCase = candidateCases[index];

    if (referenceCase.id !== candidateCase.id) {
      diffs.push({ caseId: '<snapshot>', fieldPath: `cases[${index}].id`, left: referenceCase.id, right: candidateCase.id });
      continue;
    }

    const caseDiffs = [];
    compareValues(referenceCase, candidateCase, 'case', caseDiffs);
    for (const diff of caseDiffs) {
      diffs.push({ caseId: referenceCase.id, ...diff });
      if (diffs.length >= 12) {
        return diffs;
      }
    }
  }

  return diffs;
}

function printMismatch(diffs, candidateName) {
  console.error(`Package parity mismatch between TypeScript and ${candidateName} snapshots.`);
  for (const diff of diffs) {
    console.error(`- case ${diff.caseId}: ${diff.fieldPath}`);
    console.error(`  typescript: ${formatValue(diff.left)}`);
    console.error(`  ${candidateName.padEnd(10)}: ${formatValue(diff.right)}`);
  }
}

// Every public function in the API manifest must be exercised by at least one
// parity case, so a function added to one package cannot skip the comparison.
function assertFixtureCoverage(fixture) {
  const manifest = JSON.parse(fs.readFileSync(apiManifestPath, 'utf8'));
  const operations = new Set(fixture.cases.map((testCase) => testCase.operation));
  const missing = manifest.functions
    .map((mapping) => mapping.typescript)
    .filter((name) => !operations.has(name));

  if (missing.length > 0) {
    throw new Error(`Parity fixtures do not exercise these public functions: ${missing.join(', ')}. Add a case to ${path.relative(repoRoot, defaultFixturePath)} and support the operation in every package snapshot runner.`);
  }
}

// Raw-registry operations must reproduce the canonical registry exactly, which
// catches a package that drops or renames a registry field when decoding it.
const canonicalOperations = {
  getRawHarnessData: (registry) => registry,
  getHarnessMatrix: (registry) => registry,
  listHarnesses: (registry) => registry.harnesses
};

function canonicalDiffs(snapshot) {
  const registry = JSON.parse(fs.readFileSync(canonicalRegistryPath, 'utf8'));
  const diffs = [];
  for (const testCase of snapshot.cases ?? []) {
    const expected = canonicalOperations[testCase.operation];
    if (!expected || testCase.skipped) {
      continue;
    }
    const caseDiffs = [];
    compareValues(expected(registry), testCase.result, 'result', caseDiffs);
    diffs.push(...caseDiffs.map((diff) => ({ caseId: testCase.id, ...diff })));
    if (diffs.length >= 12) {
      break;
    }
  }
  return diffs;
}

function main() {
  const { fixturePath } = parseArgs(process.argv);
  const fixture = readFixtureFile(fixturePath);
  if (fixturePath === defaultFixturePath) {
    assertFixtureCoverage(fixture);
  }

  const snapshots = [
    {
      name: 'typescript',
      snapshot: runSnapshot('node', [tsHelperPath, fixturePath], {
        cwd: repoRoot,
        label: 'TypeScript parity snapshot'
      })
    },
    {
      name: 'go',
      snapshot: maybeForceMismatch(
        runSnapshot(process.env.GO ?? 'go', ['run', './internal/paritysnapshot', fixturePath], {
          cwd: goPackageDir,
          label: 'Go parity snapshot'
        })
      )
    },
    {
      name: 'rust',
      snapshot: runSnapshot(process.env.CARGO ?? 'cargo', ['run', '--quiet', '--example', 'parity_snapshot', '--', fixturePath], {
        cwd: rustPackageDir,
        label: 'Rust parity snapshot'
      })
    },
    {
      name: 'python',
      snapshot: runSnapshot(pythonCommand, ['scripts/parity_snapshot.py', fixturePath], {
        cwd: pythonPackageDir,
        env: { PYTHONPATH: path.join(pythonPackageDir, 'src') },
        label: 'Python parity snapshot'
      })
    }
  ];

  for (const candidate of snapshots) {
    const diffs = canonicalDiffs(candidate.snapshot);
    if (diffs.length > 0) {
      console.error(`${candidate.name} raw registry output does not match packages/data/harnesses.json.`);
      for (const diff of diffs) {
        console.error(`- case ${diff.caseId}: ${diff.fieldPath}`);
        console.error(`  canonical : ${formatValue(diff.left)}`);
        console.error(`  ${candidate.name.padEnd(10)}: ${formatValue(diff.right)}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const reference = snapshots[0];
  for (const candidate of snapshots.slice(1)) {
    const diffs = compareSnapshots(reference.snapshot, candidate.snapshot);
    if (diffs.length > 0) {
      printMismatch(diffs, candidate.name);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Package parity OK (${fixture.cases.length} cases, version ${String(fixture.version ?? null)}, packages: ${snapshots.map((entry) => entry.name).join(', ')}).`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
