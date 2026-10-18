import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(
  new URL("../packages/typescript/package.json", import.meta.url)
);
const Ajv2020 = require("ajv/dist/2020");
export const registryPath = fileURLToPath(
  new URL("../packages/data/harnesses.json", import.meta.url)
);
export const registrySchema = JSON.parse(
  readFileSync(
    new URL("../packages/data/harnesses.schema.json", import.meta.url),
    "utf-8"
  )
);
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(registrySchema);

export const identifierErrors = (harnesses) => {
  const owners = new Map();
  const errors = [];
  for (const harness of harnesses) {
    for (const identifier of [harness.key, ...harness.aliases]) {
      const normalized = identifier.trim().toLowerCase();
      const owner = owners.get(normalized);
      if (owner && owner !== harness) {
        errors.push(
          `Identifier ${JSON.stringify(identifier)} collides between ${owner.key} and ${harness.key}`
        );
      }
      owners.set(normalized, harness);
    }
  }
  return errors;
};

export const validateRegistry = (registry) => {
  if (!validate(registry)) {
    return validate.errors.map(
      (error) =>
        `${error.instancePath || "/"} ${ajv.errorsText([error], { dataVar: "registry" })}`
    );
  }

  const errors = identifierErrors(registry.harnesses);
  const checkIds = (entries, label, field = "id") => {
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry[field])) {
        errors.push(
          `${label}: duplicate ${field} ${JSON.stringify(entry[field])}`
        );
      }
      seen.add(entry[field]);
    }
  };
  for (const harness of registry.harnesses) {
    checkIds(harness.paths, `${harness.key}.paths`);
    checkIds(harness.roots || [], `${harness.key}.roots`, "name");
    for (const [area, scopes] of Object.entries(harness.support)) {
      for (const [scope, leaf] of Object.entries(scopes)) {
        checkIds(leaf.paths, `${harness.key}.support.${area}.${scope}.paths`);
      }
    }
  }
  return errors;
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { help: { type: "boolean" } },
    });
    if (values.help) {
      console.log(
        "Usage: node scripts/validate-registry.mjs [registry.json]\nValidate JSON Schema and registry identifier/path invariants. Defaults to the canonical registry."
      );
    } else {
      if (positionals.length > 1) {
        throw new Error(
          "Expected at most one registry JSON file. Use --help for usage."
        );
      }
      const filename = positionals[0] || registryPath;
      const errors = validateRegistry(
        JSON.parse(readFileSync(filename, "utf-8"))
      );
      if (errors.length) {
        throw new Error(errors.join("\n"));
      }
      console.log(`Registry valid: ${filename}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
