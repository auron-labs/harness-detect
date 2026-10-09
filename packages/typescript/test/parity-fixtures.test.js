import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

test("shared parity fixtures produce the expected detection results", async (t) => {
  const fixturePath = fileURLToPath(new URL("../../../testdata/package-parity-cases.json", import.meta.url));
  const snapshotPath = fileURLToPath(new URL("../scripts/parity-snapshot.js", import.meta.url));
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const output = spawnSync("node", [snapshotPath, fixturePath], { encoding: "utf8" });
  assert.equal(output.status, 0, output.stderr || String(output.error));
  const snapshot = JSON.parse(output.stdout);

  for (const testCase of fixture.cases) {
    if (!testCase.expect) continue;
    const actual = snapshot.cases.find((entry) => entry.id === testCase.id);
    assert.ok(actual, `Missing snapshot for ${testCase.id}`);
    await t.test(testCase.id, { skip: actual.skipped === true }, () => {
      for (const [field, expected] of Object.entries(testCase.expect)) {
        if (field === "pathAssertions") {
          for (const expectedPath of expected) {
            assert.deepEqual(actual.result.paths.find((entry) => entry.id === expectedPath.id), expectedPath);
          }
        } else {
          assert.deepEqual(actual.result[field], expected, `${testCase.id}: ${field}`);
        }
      }
    });
  }
});
