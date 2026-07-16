import { readFile } from "node:fs/promises";

const registryUrl = new URL("./packages/data/harnesses.json", import.meta.url);

async function getHarnessCount() {
  const registry = JSON.parse(await readFile(registryUrl, "utf8"));
  return registry.harnesses.length;
}

export default {
  input: ["README.md", "docs/index.md", "docs/api.md", "docs/configuration.md"],
  generators: {
    "repo-stats": {
      name: "repo-stats",
      async generate({ args }) {
        const harnessCount = await getHarnessCount();

        switch (args.section) {
          case "harness-count-sentence":
            return { contents: `The registry currently covers **${harnessCount} harnesses**.` };
          case "get-harness-matrix-example":
            return {
              contents: `\`\`\`js
import { getHarnessMatrix } from "@auron-labs/harness-detect";

const matrix = getHarnessMatrix();
console.log(matrix.version);           // 1
console.log(matrix.harnesses.length);  // ${harnessCount}
\`\`\``
            };
          case "data-export-example":
            return {
              contents: `\`\`\`js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const harnesses = require("@auron-labs/harness-detect/data");

console.log(harnesses.version);
console.log(harnesses.harnesses.length);  // ${harnessCount}
\`\`\``
            };
          default:
            throw new Error(`Unsupported repo-stats section: ${args.section}`);
        }
      }
    }
  }
};
