import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "..");

const goModulePath = await realpath(
  path.join(repositoryRoot, "packages/golang")
);

const consumerDir = await mkdtemp(
  path.join(os.tmpdir(), "harness-detect-go-consumer-")
);

try {
  await writeFile(
    path.join(consumerDir, "go.mod"),
    `module harness-detect-consumer

go 1.26.9

require github.com/auron-labs/harness-detect/packages/golang v0.0.0

replace github.com/auron-labs/harness-detect/packages/golang => ${goModulePath}
`
  );
  await writeFile(
    path.join(consumerDir, "main.go"),
    `package main

import (
	"fmt"

	harnessdetect "github.com/auron-labs/harness-detect/packages/golang/harnessdetect"
)

func main() {
	matrix := harnessdetect.GetHarnessMatrix()
	if matrix.Version != 1 || len(matrix.Harnesses) == 0 {
		panic("unexpected harness matrix")
	}
	fmt.Printf("external Go consumer loaded %d harnesses\\n", len(matrix.Harnesses))
}
`
  );

  const result = spawnSync("go", ["run", "."], {
    cwd: consumerDir,
    encoding: "utf-8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    process.stdout.write(result.stdout);
  } else {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exitCode = result.status ?? 1;
  }
} finally {
  await rm(consumerDir, { force: true, recursive: true });
}
