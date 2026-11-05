import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { getHarnessAcp, listHarnessAcp, getRawHarnessData } from "../src/index.js";

const fixtureUrl = new URL("../../../testdata/acp-registry.json", import.meta.url);
const unknown = { status: "unknown", sources: [], confidence: "unknown" };

test("ACP getters reflect stored metadata and preserve optional omission", () => {
  const raw = getRawHarnessData();
  for (const h of raw.harnesses) {
    assert.deepEqual(getHarnessAcp(h.key).acp, h.acp ?? unknown);
  }
  assert.equal(getHarnessAcp(" OPENAI/CODEX ").key, "codex");
  assert.deepEqual(listHarnessAcp(), raw.harnesses.map((h) => ({ key: h.key, name: h.name, acp: h.acp ?? unknown })));
  assert.throws(() => getHarnessAcp("absent"), /Unknown harness: absent/u);
});

test("synthetic ACP getters, raw/list/detection snapshots and adapter lookup", async () => {
  // Load the unchanged runtime against disposable fixture data, never the package registry.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-acp-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "data"));
    fs.copyFileSync(new URL("../src/index.js", import.meta.url), path.join(root, "src/index.mjs"));
    fs.copyFileSync(fixtureUrl, path.join(root, "data/harnesses.json"));
    const api = await import(pathToFileURL(path.join(root, "src/index.mjs")).href);
    const expected = JSON.parse(fs.readFileSync(fixtureUrl, "utf8"));
    assert.deepEqual(api.getRawHarnessData(), expected);
    assert.equal(api.getHarnessAcp(" NATIVE-ALIAS ").key, "native");
    const host = api.getHarnessAcp("host");
    assert.equal(api.getHarnessAcp(host.acp.adapter).acp.launch.command, "example-bridge");
    assert.deepEqual(api.getHarnessAcp("bridge").acp.launch.args, []);
    assert.deepEqual(api.getHarnessAcp("missing").acp, unknown);
    assert.equal(api.getHarnessAcp("unsupported").acp.status, "unsupported");
    assert.deepEqual(api.getHarnessAcp("unknown").acp, unknown);
    const records = api.listHarnessAcp();
    assert.equal(records.length, expected.harnesses.length);
    records[0].acp.launch.args.push("mutated");
    records[0].acp.launch.platforms.push("win32");
    records[0].acp.sources.push("https://example.com/mutated");
    const first = api.getHarnessAcp("native");
    first.acp.launch.command = "mutated";
    for (const h of api.listHarnesses()) {
      const result = api.checkHarness(h.key, { cwd: root, env: { HOME: root, PATH: "" } });
      assert.equal(result.installed, false, "ACP is not installation evidence");
      assert.deepEqual(result.harness, h);
      if (h.acp?.launch) h.acp.launch.args.push("mutated");
      if (result.harness.acp?.launch) result.harness.acp.launch.args.push("mutated");
    }
    const raw = api.getRawHarnessData();
    raw.harnesses[0].acp.launch.args.push("mutated");
    assert.deepEqual(api.getRawHarnessData(), expected);
    assert.deepEqual(api.getHarnessAcp("native").acp, expected.harnesses[0].acp);
    assert.ok(!Object.hasOwn(api.getHarnessSupport("native"), "acp"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
