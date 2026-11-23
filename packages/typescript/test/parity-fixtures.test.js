import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkHarness } from "../src/index.js";

for (const [id, launcher] of [
  [
    "linux-system-npm-launcher",
    "/usr/lib/node_modules/talon-agent/bin/talon.js",
  ],
  [
    "linux-homebrew-npm-launcher",
    "/home/linuxbrew/.linuxbrew/lib/node_modules/talon-agent/bin/talon.js",
  ],
]) {
  test(
    `Talon detects only the ${id} when present`,
    { skip: process.platform !== "linux" },
    () => {
      const originalStat = fs.statSync;
      fs.statSync = (candidate) => {
        if (candidate === launcher) {
          return { isFile: () => true };
        }
        throw new Error("No other installation markers in this fixture");
      };
      try {
        const result = checkHarness("talon", {
          env: { HOME: "/unused", PATH: "" },
        });
        assert.equal(result.installed, true);
        assert.equal(result.executablePath, null);
        assert.deepEqual(
          result.matchedPaths.map((entry) => entry.id),
          [id]
        );
      } finally {
        fs.statSync = originalStat;
      }
    }
  );
}

test("shared parity fixtures produce the expected detection results", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("../../../testdata/package-parity-cases.json", import.meta.url)
  );
  const snapshotPath = fileURLToPath(
    new URL("../scripts/parity-snapshot.js", import.meta.url)
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  const output = spawnSync("node", [snapshotPath, fixturePath], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(output.status, 0, output.stderr || String(output.error));
  const snapshot = JSON.parse(output.stdout);

  const expectationCases = fixture.cases.filter((testCase) => testCase.expect);
  await Promise.all(
    expectationCases.map((testCase) => {
      const actual = snapshot.cases.find((entry) => entry.id === testCase.id);
      assert.ok(actual, `Missing snapshot for ${testCase.id}`);
      return t.test(testCase.id, { skip: actual.skipped === true }, () => {
        for (const [field, expected] of Object.entries(testCase.expect)) {
          if (field === "pathAssertions") {
            for (const expectedPath of expected) {
              const actualPath = actual.result.paths.find(
                (entry) => entry.id === expectedPath.id
              );
              assert.ok(
                actualPath,
                `${testCase.id}: missing path ${expectedPath.id}`
              );
              for (const [key, value] of Object.entries(expectedPath)) {
                assert.deepEqual(
                  actualPath[key],
                  value,
                  `${testCase.id}: ${expectedPath.id}.${key}`
                );
              }
            }
          } else {
            assert.deepEqual(
              actual.result[field],
              expected,
              `${testCase.id}: ${field}`
            );
          }
        }
      });
    })
  );
});
