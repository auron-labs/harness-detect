import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

import config from "../automd.config.mjs";

const require = createRequire(
  new URL("../packages/typescript/package.json", import.meta.url)
);
const { transform } = await import(
  pathToFileURL(require.resolve("automd")).href
);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

await Promise.all(
  config.input.map(async (input) => {
    const url = new URL(input, pathToFileURL(`${repoRoot}/`));
    const contents = await readFile(url, "utf-8");
    const result = await transform(
      contents,
      { ...config, dir: repoRoot },
      url.href
    );
    if (result.hasIssues || result.contents !== contents) {
      console.error(
        `${input}: generated stats are stale or invalid. Run: mise run docs:generate`
      );
      process.exitCode = 1;
    }
  })
);
if (!process.exitCode) {
  console.log("Generated documentation stats are up to date.");
}
