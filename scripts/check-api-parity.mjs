import fs from "node:fs";
import path from "node:path";

const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const repoRoot = path.resolve(__dirname, "..");

const defaultPaths = {
  manifest: path.join(repoRoot, "testdata", "public-api-parity.json"),
  tsTest: path.join(
    repoRoot,
    "packages",
    "typescript",
    "test",
    "index.test.js"
  ),
  goTest: path.join(
    repoRoot,
    "packages",
    "golang",
    "harnessdetect",
    "harnessdetect_public_api_test.go"
  ),
  rustLib: path.join(repoRoot, "packages", "rust", "src", "lib.rs"),
  pythonInit: path.join(
    repoRoot,
    "packages",
    "python",
    "src",
    "harness_detect",
    "__init__.py"
  ),
  packageGuide: path.join(repoRoot, "docs", "package-guide.md"),
  tsReadme: path.join(repoRoot, "packages", "typescript", "README.md"),
  goReadme: path.join(repoRoot, "packages", "golang", "README.md"),
  rustReadme: path.join(repoRoot, "packages", "rust", "README.md"),
  pythonReadme: path.join(repoRoot, "packages", "python", "README.md"),
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const parseArgs = (argv) => {
  const options = { ...defaultPaths };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (
      arg === "--manifest" ||
      arg === "--ts-test" ||
      arg === "--go-test" ||
      arg === "--rust-lib" ||
      arg === "--python-init"
    ) {
      const value = argv[index + 1];

      if (!value) {
        fail(`Missing value for ${arg}`);
      }

      const resolved = path.resolve(process.cwd(), value);

      if (arg === "--manifest") {
        options.manifest = resolved;
      } else if (arg === "--ts-test") {
        options.tsTest = resolved;
      } else if (arg === "--go-test") {
        options.goTest = resolved;
      } else if (arg === "--rust-lib") {
        options.rustLib = resolved;
      } else {
        options.pythonInit = resolved;
      }

      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf-8"));

const isRecord = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- manifest JSON is untrusted input validated at this boundary
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertString = (value, label) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- manifest JSON is untrusted input validated at this boundary
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
};

const validateManifest = (manifest) => {
  if (!isRecord(manifest)) {
    fail("Manifest must be a JSON object");
  }

  if (manifest.schemaVersion !== 1) {
    fail(
      `Manifest schemaVersion must be 1, got ${JSON.stringify(manifest.schemaVersion)}`
    );
  }

  if (!isRecord(manifest.packages)) {
    fail("Manifest packages must be an object");
  }

  assertString(manifest.packages.typescript, "packages.typescript");
  assertString(manifest.packages.go, "packages.go");
  assertString(manifest.packages.rust, "packages.rust");
  assertString(manifest.packages.python, "packages.python");

  if (!Array.isArray(manifest.functions) || manifest.functions.length === 0) {
    fail("Manifest functions must be a non-empty array");
  }

  const seenTs = new Set();
  const seenGo = new Set();
  const seenRust = new Set();
  const seenPython = new Set();

  for (const [index, mapping] of manifest.functions.entries()) {
    if (!isRecord(mapping)) {
      fail(`functions[${index}] must be an object`);
    }

    assertString(mapping.typescript, `functions[${index}].typescript`);
    assertString(mapping.go, `functions[${index}].go`);
    assertString(mapping.rust, `functions[${index}].rust`);
    assertString(mapping.python, `functions[${index}].python`);

    if (seenTs.has(mapping.typescript)) {
      fail(`Duplicate TypeScript function in manifest: ${mapping.typescript}`);
    }

    if (seenGo.has(mapping.go)) {
      fail(`Duplicate Go function in manifest: ${mapping.go}`);
    }

    if (seenRust.has(mapping.rust)) {
      fail(`Duplicate Rust function in manifest: ${mapping.rust}`);
    }

    if (seenPython.has(mapping.python)) {
      fail(`Duplicate Python function in manifest: ${mapping.python}`);
    }

    seenTs.add(mapping.typescript);
    seenGo.add(mapping.go);
    seenRust.add(mapping.rust);
    seenPython.add(mapping.python);
  }

  if (
    !seenTs.has("getRawHarnessData") ||
    !seenGo.has("GetRawHarnessData") ||
    !seenRust.has("get_raw_harness_data") ||
    !seenPython.has("get_raw_harness_data")
  ) {
    fail("Manifest must include raw-registry accessors for every package");
  }

  validateCoreFields(manifest.coreFields);
};

const validateCoreFields = (coreFields) => {
  if (!isRecord(coreFields)) {
    fail("Manifest coreFields must be an object");
  }

  for (const [typeName, fields] of Object.entries(coreFields)) {
    assertString(typeName, "coreFields type name");

    if (!Array.isArray(fields) || fields.length === 0) {
      fail(`coreFields.${typeName} must be a non-empty array`);
    }

    const jsonNames = new Set();

    for (const [index, field] of fields.entries()) {
      if (!isRecord(field)) {
        fail(`coreFields.${typeName}[${index}] must be an object`);
      }

      assertString(field.json, `coreFields.${typeName}[${index}].json`);
      assertString(
        field.typescript,
        `coreFields.${typeName}[${index}].typescript`
      );
      assertString(field.go, `coreFields.${typeName}[${index}].go`);

      if (jsonNames.has(field.json)) {
        fail(`Duplicate JSON field in coreFields.${typeName}: ${field.json}`);
      }

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- manifest JSON is untrusted input validated at this boundary
      if ("nullable" in field && typeof field.nullable !== "boolean") {
        fail(
          `coreFields.${typeName}[${index}].nullable must be a boolean when present`
        );
      }

      jsonNames.add(field.json);
    }
  }
};

const parseLockedTsExports = (filePath) => {
  const source = fs.readFileSync(filePath, "utf-8");

  const match = source.match(
    /const\s+LOCKED_RUNTIME_EXPORTS\s*=\s*\[(?<body>.*?)\];/su
  );

  if (!match) {
    fail(`Could not find LOCKED_RUNTIME_EXPORTS in ${filePath}`);
  }

  return [
    ...match.groups.body.matchAll(/"(?<double>[^"]+)"|'(?<single>[^']+)'/gu),
  ].map(({ groups }) => groups.double ?? groups.single);
};

const parseLockedGoExports = (filePath) => {
  const source = fs.readFileSync(filePath, "utf-8");

  const matches = [
    ...source.matchAll(
      /^\s*_\s+func\b[^\n=]*=\s*harnessdetect\.(?<name>\w+)/gmu
    ),
  ];

  if (matches.length === 0) {
    fail(`Could not find locked Go function declarations in ${filePath}`);
  }

  return matches.map(({ groups }) => groups.name);
};

const parseRustExports = (filePath) => {
  const source = fs.readFileSync(filePath, "utf-8");
  const matches = [...source.matchAll(/^pub\s+fn\s+(?<name>\w+)\s*\(/gmu)];

  if (matches.length === 0) {
    fail(`Could not find public Rust functions in ${filePath}`);
  }

  return matches.map(({ groups }) => groups.name);
};

const parsePythonExports = (filePath) => {
  const source = fs.readFileSync(filePath, "utf-8");
  const allMatch = source.match(/__all__\s*=\s*\[(?<body>.*?)\]/su);

  if (!allMatch) {
    fail(`Could not find __all__ in ${filePath}`);
  }

  const exportedNames = [
    ...allMatch.groups.body.matchAll(/"(?<double>[^"]+)"|'(?<single>[^']+)'/gu),
  ].map(({ groups }) => groups.double ?? groups.single);

  const functionNames = new Set(
    [...source.matchAll(/^def\s+(?<name>\w+)\s*\(/gmu)].map(
      ({ groups }) => groups.name
    )
  );

  const exportedFunctions = exportedNames.filter((name) =>
    functionNames.has(name)
  );

  if (exportedFunctions.length === 0) {
    fail(`Could not find exported Python functions in ${filePath}`);
  }

  return exportedFunctions;
};

const compareFunctionList = (label, expected, actual) => {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const extra = actual.filter((name) => !expectedSet.has(name));

  if (
    missing.length === 0 &&
    extra.length === 0 &&
    expected.length === actual.length
  ) {
    return;
  }

  const details = [];

  if (missing.length > 0) {
    details.push(`missing: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    details.push(`extra: ${extra.join(", ")}`);
  }

  if (expected.length !== actual.length) {
    details.push(`count: expected ${expected.length}, got ${actual.length}`);
  }

  fail(`${label} function list mismatch (${details.join("; ")})`);
};

const assertDocMentions = (label, filePath, names) => {
  const source = fs.readFileSync(filePath, "utf-8");

  const missing = names.filter(
    (name) =>
      !source.includes(`\`${name}\``) &&
      !source.includes(`\`${name}()\``) &&
      !source.includes(`\`${name}(`)
  );

  if (missing.length > 0) {
    fail(`${label} is missing documented API names: ${missing.join(", ")}`);
  }
};

const main = () => {
  const options = parseArgs(process.argv);
  const manifest = readJson(options.manifest);

  validateManifest(manifest);

  const expectedTsFunctions = manifest.functions.map(
    (mapping) => mapping.typescript
  );

  const expectedGoFunctions = manifest.functions.map((mapping) => mapping.go);

  const expectedRustFunctions = manifest.functions.map(
    (mapping) => mapping.rust
  );

  const expectedPythonFunctions = manifest.functions.map(
    (mapping) => mapping.python
  );

  const actualTsFunctions = parseLockedTsExports(options.tsTest);
  const actualGoFunctions = parseLockedGoExports(options.goTest);
  const actualRustFunctions = parseRustExports(options.rustLib);
  const actualPythonFunctions = parsePythonExports(options.pythonInit);

  compareFunctionList(
    "TypeScript public API lock",
    expectedTsFunctions,
    actualTsFunctions
  );
  compareFunctionList(
    "Go public API lock",
    expectedGoFunctions,
    actualGoFunctions
  );
  compareFunctionList(
    "Rust public API lock",
    expectedRustFunctions,
    actualRustFunctions
  );
  compareFunctionList(
    "Python public API lock",
    expectedPythonFunctions,
    actualPythonFunctions
  );
  assertDocMentions("PACKAGE_GUIDE.md", options.packageGuide, [
    ...expectedTsFunctions,
    ...expectedGoFunctions,
    ...expectedRustFunctions,
    ...expectedPythonFunctions,
  ]);
  assertDocMentions(
    "packages/typescript/README.md",
    options.tsReadme,
    expectedTsFunctions
  );
  assertDocMentions(
    "packages/golang/README.md",
    options.goReadme,
    expectedGoFunctions
  );
  assertDocMentions(
    "packages/rust/README.md",
    options.rustReadme,
    expectedRustFunctions
  );
  assertDocMentions(
    "packages/python/README.md",
    options.pythonReadme,
    expectedPythonFunctions
  );

  console.log(
    `API parity OK: ${expectedTsFunctions.length} function mappings across TypeScript, Go, Rust, and Python, including raw-registry accessors, and docs match the manifest.`
  );
};

main();
