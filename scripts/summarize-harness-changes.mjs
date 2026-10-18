import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const registryFile = "packages/data/harnesses.json";

const describeChange = (label, before, after) => {
  if (isDeepStrictEqual(before, after)) {
    return [];
  }
  return [
    `- ${label}: ${JSON.stringify(before ?? null)} → ${JSON.stringify(after ?? null)}`,
  ];
};

const supportChanges = (before = {}, after = {}) => {
  const lines = [];
  for (const area of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const oldScopes = before[area] || {};
    const newScopes = after[area] || {};
    for (const scope of new Set([
      ...Object.keys(oldScopes),
      ...Object.keys(newScopes),
    ])) {
      lines.push(
        ...describeChange(
          `support.${area}.${scope}`,
          oldScopes[scope],
          newScopes[scope]
        )
      );
    }
  }
  return lines;
};

export const summarizeHarnessChanges = (before, after) => {
  const oldEntries = new Map(
    before.harnesses.map((harness) => [harness.key, harness])
  );
  const newEntries = new Map(
    after.harnesses.map((harness) => [harness.key, harness])
  );
  const lines = [];
  for (const key of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
    const oldEntry = oldEntries.get(key);
    const newEntry = newEntries.get(key);
    if (isDeepStrictEqual(oldEntry, newEntry)) {
      continue;
    }
    let kind = "updated";
    if (!oldEntry) {
      kind = "added";
    } else if (!newEntry) {
      kind = "removed";
    }
    lines.push(`\n### ${key} (${kind})\n`);
    const previous = oldEntry || {};
    const current = newEntry || {};
    for (const field of new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ])) {
      if (field === "key" || field === "support") {
        continue;
      }
      lines.push(...describeChange(field, previous[field], current[field]));
    }
    lines.push(...supportChanges(previous.support, current.support));
  }
  lines.push(
    ...describeChange("registry version", before.version, after.version)
  );
  return lines.length
    ? `## Harness registry changes\n${lines.join("\n")}\n`
    : "No harness registry changes.\n";
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        base: { default: "HEAD", type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: node scripts/summarize-harness-changes.mjs [--base <git-ref>]\nCompare the canonical working registry with a Git revision (default HEAD). Read-only Markdown output."
      );
    } else {
      if (positionals.length || values.base.startsWith("-")) {
        throw new Error("Expected --base <git-ref>. Use --help for usage.");
      }
      const before = JSON.parse(
        execFileSync("git", ["show", `${values.base}:${registryFile}`], {
          cwd: repoRoot,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      );
      const after = JSON.parse(
        readFileSync(path.join(repoRoot, registryFile), "utf-8")
      );
      process.stdout.write(summarizeHarnessChanges(before, after));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
