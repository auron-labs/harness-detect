import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const registryPath = path.join(repoRoot, 'packages', 'data', 'harnesses.json');
const outputPath = path.join(repoRoot, 'docs', 'support-matrix.md');

const SUPPORT_AREAS = [
  { key: 'config', label: 'config' },
  { key: 'skills', label: 'skills' },
  { key: 'commands', label: 'commands' },
  { key: 'agents', label: 'agents' },
  { key: 'dotAgents', label: '`.agents` support' }
];
const SUPPORT_SCOPES = ['global', 'local'];
const STATUS_ORDER = ['supported', 'unsupported', 'unknown'];
const CONFIDENCE_ORDER = ['official', 'source', 'observed', 'inferred', 'unknown'];

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const checkOnly = args.has('--check');
  const printSummary = args.has('--summary');
  const invalidArgs = [...args].filter((arg) => arg !== '--check' && arg !== '--summary');

  if (invalidArgs.length > 0) {
    fail(`Unknown argument(s): ${invalidArgs.join(', ')}`, 2);
  }

  return { checkOnly, printSummary };
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function escapeCell(value) {
  return value.replace(/\r?\n/g, '<br>').replaceAll('|', '\\|');
}

function readRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assertObject(registry, 'Registry root');
  assertArray(registry.harnesses, 'Registry harnesses');
  return registry;
}

function validateSupportPath(pathSpec, label) {
  assertObject(pathSpec, label);
  assertNonEmptyString(pathSpec.id, `${label}.id`);
  assertNonEmptyString(pathSpec.kind, `${label}.kind`);
  assertNonEmptyString(pathSpec.template, `${label}.template`);
}

function validateSupportLeaf(leaf, label) {
  assertObject(leaf, label);
  assertNonEmptyString(leaf.status, `${label}.status`);
  if (!STATUS_ORDER.includes(leaf.status)) {
    fail(`${label}.status must be one of: ${STATUS_ORDER.join(', ')}`);
  }

  assertArray(leaf.paths, `${label}.paths`);
  for (const [index, pathSpec] of leaf.paths.entries()) {
    validateSupportPath(pathSpec, `${label}.paths[${index}]`);
  }

  assertArray(leaf.sources, `${label}.sources`);
  for (const [index, source] of leaf.sources.entries()) {
    assertNonEmptyString(source, `${label}.sources[${index}]`);
  }

  assertNonEmptyString(leaf.confidence, `${label}.confidence`);
  if (!CONFIDENCE_ORDER.includes(leaf.confidence)) {
    fail(`${label}.confidence must be one of: ${CONFIDENCE_ORDER.join(', ')}`);
  }

  if (leaf.notes !== undefined && (typeof leaf.notes !== 'string' || leaf.notes.length === 0)) {
    fail(`${label}.notes must be a non-empty string when present`);
  }
}

function validateHarness(harness, index) {
  const label = `harnesses[${index}]`;
  assertObject(harness, label);
  assertNonEmptyString(harness.key, `${label}.key`);
  assertNonEmptyString(harness.name, `${label}.name`);

  if (!('support' in harness)) {
    fail(`${label} (${harness.key}) is missing required support metadata`);
  }

  assertObject(harness.support, `${label}.support`);
  for (const area of SUPPORT_AREAS) {
    const supportArea = harness.support[area.key];
    const areaLabel = `${label}.support.${area.key}`;
    assertObject(supportArea, areaLabel);

    for (const scope of SUPPORT_SCOPES) {
      validateSupportLeaf(supportArea[scope], `${areaLabel}.${scope}`);
    }
  }
}

function summarizeStatuses(harnesses) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));

  for (const harness of harnesses) {
    for (const area of SUPPORT_AREAS) {
      for (const scope of SUPPORT_SCOPES) {
        counts[harness.support[area.key][scope].status] += 1;
      }
    }
  }

  return counts;
}

function formatStatusSummary(counts) {
  return STATUS_ORDER.map((status) => `${status}: ${counts[status]}`).join('; ');
}

function formatLeaf(leaf) {
  if (leaf.status === 'unsupported') {
    return 'no';
  }

  if (leaf.status === 'unknown') {
    return 'unknown';
  }

  const parts = ['yes'];
  if (leaf.paths.length === 0) {
    parts.push('path unknown');
  } else {
    for (const pathSpec of leaf.paths) {
      parts.push(`\`${pathSpec.template}\``);
    }
  }

  return escapeCell(parts.join('<br>'));
}

function formatSummaryCell(harness) {
  const confidenceCounts = new Map();
  const sources = new Set();
  const notes = [];
  const seenNotes = new Set();

  for (const area of SUPPORT_AREAS) {
    for (const scope of SUPPORT_SCOPES) {
      const leaf = harness.support[area.key][scope];
      confidenceCounts.set(leaf.confidence, (confidenceCounts.get(leaf.confidence) ?? 0) + 1);
      for (const source of leaf.sources) {
        sources.add(source);
      }

      if (leaf.notes && !seenNotes.has(leaf.notes)) {
        seenNotes.add(leaf.notes);
        notes.push(leaf.notes);
      }
    }
  }

  const summary = [
    CONFIDENCE_ORDER
      .filter((confidence) => (confidenceCounts.get(confidence) ?? 0) > 0)
      .map((confidence) => {
        const count = confidenceCounts.get(confidence);
        return `${confidence}: ${count} area${count === 1 ? '' : 's'}`;
      })
      .join('; '),
    `sources: ${sources.size}`
  ].join('; ');

  const lines = [summary, ...notes];

  return escapeCell(lines.join('<br>'));
}

function generateSupportMatrix(registry) {
  const harnesses = [...registry.harnesses];
  harnesses.forEach(validateHarness);
  harnesses.sort((left, right) => left.key.localeCompare(right.key));
  const statusCounts = summarizeStatuses(harnesses);

  const headerLines = [
    '<!-- Generated by scripts/generate-support-matrix.mjs; do not edit by hand. -->',
    '',
    '# Support matrix',
    '',
    'Generated from `packages/data/harnesses.json`. Rows are sorted by `harness.key`.',
    '',
    `Support leaf status totals: ${formatStatusSummary(statusCounts)}. Unknown leaves stay explicit until the registry support metadata is verified.`,
    '',
    `| Harness | ${SUPPORT_AREAS.flatMap((area) => SUPPORT_SCOPES.map((scope) => `${scope} ${area.label}`)).join(' | ')} | notes/source confidence |`,
    `| --- | ${SUPPORT_AREAS.flatMap(() => SUPPORT_SCOPES.map(() => '---')).join(' | ')} | --- |`
  ];

  const rowLines = harnesses.map((harness) => {
    const cells = [
      `\`${harness.key}\` — ${escapeCell(harness.name)}`,
      ...SUPPORT_AREAS.flatMap((area) => SUPPORT_SCOPES.map((scope) => formatLeaf(harness.support[area.key][scope]))),
      formatSummaryCell(harness)
    ];

    return `| ${cells.join(' | ')} |`;
  });

  return `${[...headerLines, ...rowLines].join('\n')}\n`;
}

function main() {
  const { checkOnly, printSummary } = parseArgs(process.argv);
  const registry = readRegistry();
  const expected = generateSupportMatrix(registry);
  const statusCounts = summarizeStatuses(registry.harnesses);

  if (checkOnly) {
    const actual = fs.readFileSync(outputPath, 'utf8');
    if (actual !== expected) {
      console.error('docs/support-matrix.md is stale. Run: node scripts/generate-support-matrix.mjs');
      process.exit(1);
    }

    console.log('docs/support-matrix.md is up to date.');
    if (printSummary) {
      console.log(formatStatusSummary(statusCounts));
    }
    return;
  }

  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (current === expected) {
    console.log('docs/support-matrix.md is already up to date.');
    if (printSummary) {
      console.log(formatStatusSummary(statusCounts));
    }
    return;
  }

  fs.writeFileSync(outputPath, expected);
  console.log('Wrote docs/support-matrix.md');
  if (printSummary) {
    console.log(formatStatusSummary(statusCounts));
  }
}

main();
