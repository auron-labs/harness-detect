import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  identifierErrors,
  registryPath,
  registrySchema,
} from "./validate-registry.mjs";

export const scaffoldHarness = (registry, key, name, aliases = []) => {
  if (
    !new RegExp(
      registrySchema.properties.harnesses.items.properties.key.pattern,
      "u"
    ).test(key || "")
  ) {
    throw new Error(
      "Key must start with a lowercase letter and contain only lowercase letters, digits, or hyphens."
    );
  }
  if (!name?.trim()) {
    throw new Error("A non-empty harness name is required.");
  }
  if (aliases.some((alias) => !alias.trim())) {
    throw new Error("Aliases must not be blank.");
  }
  if (
    new Set(aliases.map((alias) => alias.trim().toLowerCase())).size !==
    aliases.length
  ) {
    throw new Error(
      "Aliases must be unique after trimming and case normalization."
    );
  }
  const draft = {
    aliases,
    env: [],
    executables: [],
    installations: [],
    key,
    name,
    paths: [],
    sources: [],
    support: Object.fromEntries(
      registrySchema.$defs.HarnessSupport.required.map((area) => [
        area,
        Object.fromEntries(
          registrySchema.$defs.HarnessSupportArea.required.map((scope) => [
            scope,
            {
              confidence: "unknown",
              paths: [],
              sources: [],
              status: "unknown",
            },
          ])
        ),
      ])
    ),
  };
  const errors = identifierErrors([...registry.harnesses, draft]);
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return draft;
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        alias: { multiple: true, type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: node scripts/scaffold-harness.mjs <key> <name> [--alias <alias>]\nPrint an incomplete JSON entry to stdout. Does not edit the registry. --alias may be repeated."
      );
    } else {
      if (positionals.length !== 2) {
        throw new Error(
          "Expected a key and quoted harness name. Use --help for usage."
        );
      }
      const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
      console.log(
        JSON.stringify(
          scaffoldHarness(registry, ...positionals, values.alias || []),
          null,
          2
        )
      );
      console.error(
        "Draft only: add verified detection signals, sources, and installation metadata before inserting it into packages/data/harnesses.json."
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
