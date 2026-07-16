import fs from "node:fs";

const REGISTRY_URL = new URL("../../data/harnesses.json", import.meta.url);

function formatFallback(root) {
  if (root.use && root.fallback) {
    return `\`${root.use}\` (use) or \`${root.fallback}\``;
  }
  if (root.fallback) {
    return `\`${root.fallback}\``;
  }
  return "(empty — path resolves to null)";
}

function generateEnvTable() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_URL, "utf8"));

  const rows = [];
  for (const harness of registry.harnesses) {
    for (const root of harness.roots || []) {
      rows.push({
        key: harness.key,
        env: root.env ? `\`${root.env}\`` : "—",
        name: `\`${root.name}\``,
        fallback: formatFallback(root),
      });
    }
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));

  const lines = [
    "| Harness key | Override env var | Derived root | Default fallback |",
    "|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(`| \`${row.key}\` | ${row.env} | ${row.name} | ${row.fallback} |`);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(generateEnvTable() + "\n");
}

export { generateEnvTable };
