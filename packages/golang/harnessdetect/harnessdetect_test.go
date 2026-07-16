package harnessdetect

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
)

var supportedInstallMethods = []string{"npm", "homebrew", "pip", "pipx", "uv", "cargo", "go", "script", "manual", "marketplace", "binary", "unknown"}

var expectedUnknownInstallationHarnesses = []string{
	"aider",
	"amazon-q-cli",
	"amp",
	"antigravity-cli",
	"autohand",
	"boltai",
	"cline",
	"commandcode",
	"continue",
	"crush",
	"cursor",
	"devin-for-terminal",
	"github-copilot-cli",
	"goose",
	"grok-build-cli",
	"groq-code-cli",
	"junie-cli",
	"kilo-code",
	"kimi-code-cli",
	"letta-code",
	"mistral-vibe",
	"nanocoder",
	"open-interpreter",
	"openblock",
	"openclaw",
	"opencode",
	"pieces",
	"plandex",
	"roo-code",
	"rovo-dev-cli",
	"toad",
	"warp",
	"windsurf",
}

var allowedPlatforms = []string{"aix", "android", "cygwin", "darwin", "freebsd", "haiku", "linux", "netbsd", "openbsd", "sunos", "win32"}
var expectedUsedPlatforms = []string{"darwin", "linux", "win32"}
var supportAreas = []string{"config", "skills", "commands", "agents", "dotAgents"}
var supportScopes = []string{"global", "local"}
var supportStatuses = []string{"supported", "unsupported", "unknown"}
var supportConfidenceLevels = []string{"official", "source", "observed", "inferred", "unknown"}

func tempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "harness-detect-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestEmbeddedDataMatchesSharedFile(t *testing.T) {
	// Read the shared harnesses.json from the monorepo root.
	// This test ensures we keep the embedded copy in sync.
	sharedPath := filepath.Join("..", "..", "data", "harnesses.json")
	sharedData, err := os.ReadFile(sharedPath)
	if err != nil {
		t.Fatalf("could not read shared harnesses.json at %s: %v", sharedPath, err)
	}

	if string(matrixJSON) != string(sharedData) {
		t.Fatalf("embedded harness data mismatch: packages/golang/harnessdetect/data/harnesses.json (matrixJSON) must match %s byte-for-byte; refresh packages/golang/harnessdetect/data/harnesses.json from packages/data/harnesses.json", sharedPath)
	}
}

func TestGetHarnessMatrix(t *testing.T) {
	matrix := GetHarnessMatrix()
	if matrix.Version != 1 {
		t.Fatalf("expected version 1, got %d", matrix.Version)
	}
	if len(matrix.Harnesses) < 10 {
		t.Fatalf("expected at least 10 harnesses, got %d", len(matrix.Harnesses))
	}
}

func TestGoInstallationMetadataCompleteness(t *testing.T) {
	matrix := GetRawHarnessData()
	if len(matrix.Harnesses) != 51 {
		t.Fatalf("harness count = %d, want 51", len(matrix.Harnesses))
	}

	allowedMethods := make(map[string]struct{}, len(supportedInstallMethods))
	for _, method := range supportedInstallMethods {
		allowedMethods[method] = struct{}{}
	}
	allowedPlatformSet := make(map[string]struct{}, len(allowedPlatforms))
	for _, platform := range allowedPlatforms {
		allowedPlatformSet[platform] = struct{}{}
	}

	unknownHarnesses := make([]string, 0)
	usedPlatforms := map[string]struct{}{}

	for _, harness := range matrix.Harnesses {
		if len(harness.Installations) == 0 {
			t.Fatalf("harness %q has no installations metadata", harness.Key)
		}

		for _, installation := range harness.Installations {
			if _, ok := allowedMethods[installation.Method]; !ok {
				t.Fatalf("harness %q installation method %q is outside supported vocabulary %v", harness.Key, installation.Method, supportedInstallMethods)
			}
			if installation.URL == "" {
				t.Fatalf("harness %q installation %q must keep a source URL", harness.Key, installation.Method)
			}
			for _, platform := range installation.Platforms {
				if _, ok := allowedPlatformSet[platform]; !ok {
					t.Fatalf("harness %q installation platform %q is outside allowed vocabulary %v", harness.Key, platform, allowedPlatforms)
				}
				usedPlatforms[platform] = struct{}{}
			}
			if installation.Method == "unknown" {
				unknownHarnesses = append(unknownHarnesses, harness.Key)
				if installation.URL == "" {
					t.Fatalf("harness %q unknown installation must keep source URL", harness.Key)
				}
				if installation.Notes == "" {
					t.Fatalf("harness %q unknown installation must explain missing docs", harness.Key)
				}
			}
		}

		for _, path := range harness.Paths {
			for _, platform := range path.Platforms {
				if _, ok := allowedPlatformSet[platform]; !ok {
					t.Fatalf("harness %q path %q platform %q is outside allowed vocabulary %v", harness.Key, path.ID, platform, allowedPlatforms)
				}
				usedPlatforms[platform] = struct{}{}
			}
		}
	}

	sort.Strings(unknownHarnesses)
	if !reflect.DeepEqual(unknownHarnesses, expectedUnknownInstallationHarnesses) {
		t.Fatalf("unknown installation harnesses = %v, want %v", unknownHarnesses, expectedUnknownInstallationHarnesses)
	}

	usedPlatformList := make([]string, 0, len(usedPlatforms))
	for platform := range usedPlatforms {
		usedPlatformList = append(usedPlatformList, platform)
	}
	sort.Strings(usedPlatformList)
	if !reflect.DeepEqual(usedPlatformList, expectedUsedPlatforms) {
		t.Fatalf("used platform vocabulary = %v, want %v", usedPlatformList, expectedUsedPlatforms)
	}

	codex := findHarnessDefinition(t, matrix.Harnesses, "codex")
	if !reflect.DeepEqual(codex.Installations, []HarnessInstallation{{
		Method:  "npm",
		Package: "@openai/codex",
		Command: "npm install -g @openai/codex",
		URL:     "https://developers.openai.com/codex/cli",
	}}) {
		t.Fatalf("codex installations = %#v, want npm metadata", codex.Installations)
	}
}

func TestGoInstallationMetadataExposureAcrossAPIs(t *testing.T) {
	raw := GetRawHarnessData()
	matrix := GetHarnessMatrix()
	list := ListHarnesses()
	options := CheckOptions{Env: map[string]string{"HOME": "/Users/test", "PATH": ""}, CWD: "/repo"}

	if len(matrix.Harnesses) != len(raw.Harnesses) {
		t.Fatalf("GetHarnessMatrix harness count = %d, want %d", len(matrix.Harnesses), len(raw.Harnesses))
	}
	if len(list) != len(raw.Harnesses) {
		t.Fatalf("ListHarnesses count = %d, want %d", len(list), len(raw.Harnesses))
	}

	for i, want := range raw.Harnesses {
		if !reflect.DeepEqual(matrix.Harnesses[i].Installations, want.Installations) {
			t.Fatalf("GetHarnessMatrix installations for %q = %#v, want %#v", want.Key, matrix.Harnesses[i].Installations, want.Installations)
		}
		if !reflect.DeepEqual(list[i].Installations, want.Installations) {
			t.Fatalf("ListHarnesses installations for %q = %#v, want %#v", want.Key, list[i].Installations, want.Installations)
		}

		result, err := CheckHarness(want.Key, options)
		if err != nil {
			t.Fatalf("CheckHarness(%q): %v", want.Key, err)
		}
		if !reflect.DeepEqual(result.Harness.Installations, want.Installations) {
			t.Fatalf("CheckHarness(%q) installations = %#v, want %#v", want.Key, result.Harness.Installations, want.Installations)
		}
	}
}

func TestGoSupportMetadataExposureAcrossAPIs(t *testing.T) {
	raw := GetRawHarnessData()
	matrix := GetHarnessMatrix()
	list := ListHarnesses()
	supportList := ListHarnessSupport()

	if len(supportList) != len(raw.Harnesses) {
		t.Fatalf("ListHarnessSupport count = %d, want %d", len(supportList), len(raw.Harnesses))
	}

	for i, want := range raw.Harnesses {
		if !reflect.DeepEqual(matrix.Harnesses[i].Support, want.Support) {
			t.Fatalf("GetHarnessMatrix support for %q = %#v, want %#v", want.Key, matrix.Harnesses[i].Support, want.Support)
		}
		if !reflect.DeepEqual(list[i].Support, want.Support) {
			t.Fatalf("ListHarnesses support for %q = %#v, want %#v", want.Key, list[i].Support, want.Support)
		}

		record, err := GetHarnessSupport(want.Key)
		if err != nil {
			t.Fatalf("GetHarnessSupport(%q): %v", want.Key, err)
		}
		if record.Key != want.Key || record.Name != want.Name {
			t.Fatalf("GetHarnessSupport(%q) identity = %#v, want key=%q name=%q", want.Key, record, want.Key, want.Name)
		}
		if !reflect.DeepEqual(record.Support, want.Support) {
			t.Fatalf("GetHarnessSupport(%q) support = %#v, want %#v", want.Key, record.Support, want.Support)
		}

		if supportList[i].Key != want.Key || supportList[i].Name != want.Name {
			t.Fatalf("ListHarnessSupport()[%d] identity = %#v, want key=%q name=%q", i, supportList[i], want.Key, want.Name)
		}
		if !reflect.DeepEqual(supportList[i].Support, want.Support) {
			t.Fatalf("ListHarnessSupport support for %q = %#v, want %#v", want.Key, supportList[i].Support, want.Support)
		}
	}

	codex, err := GetHarnessSupport("codex")
	if err != nil {
		t.Fatalf("GetHarnessSupport(codex): %v", err)
	}
	if codex.Support.Config.Global.Status != "supported" {
		t.Fatalf("codex config/global status = %q, want supported", codex.Support.Config.Global.Status)
	}
	if codex.Support.Config.Global.Confidence != "official" {
		t.Fatalf("codex config/global confidence = %q, want official", codex.Support.Config.Global.Confidence)
	}
}

func TestPublicRegistrySurfacesExposeDefensiveInstallationClones(t *testing.T) {
	canonical := GetRawHarnessData()
	canonicalCodex := findHarnessDefinition(t, canonical.Harnesses, "codex")

	matrixCodex := findHarnessDefinition(t, GetHarnessMatrix().Harnesses, "codex")
	listedCodex := findHarnessDefinition(t, ListHarnesses(), "codex")

	matrixCodex.Installations = append(matrixCodex.Installations, HarnessInstallation{Method: "manual", URL: "https://example.com"})
	listedCodex.Installations = append(listedCodex.Installations, HarnessInstallation{Method: "manual", URL: "https://example.com"})
	matrixCodex.Installations[0].Platforms = append(matrixCodex.Installations[0].Platforms, "plan9")
	listedCodex.Installations[0].Platforms = append(listedCodex.Installations[0].Platforms, "plan9")
	mutateInstallationSliceExtraCapacity(matrixCodex.Installations, HarnessInstallation{Method: "manual", URL: "https://example.com"})
	mutateInstallationSliceExtraCapacity(listedCodex.Installations, HarnessInstallation{Method: "manual", URL: "https://example.com"})
	mutateStringSliceExtraCapacity(matrixCodex.Installations[0].Platforms, "plan9")
	mutateStringSliceExtraCapacity(listedCodex.Installations[0].Platforms, "plan9")

	matrixAgain := findHarnessDefinition(t, GetHarnessMatrix().Harnesses, "codex")
	listedAgain := findHarnessDefinition(t, ListHarnesses(), "codex")

	if !reflect.DeepEqual(matrixAgain.Installations, canonicalCodex.Installations) {
		t.Fatalf("GetHarnessMatrix() installations for codex = %#v, want %#v", matrixAgain.Installations, canonicalCodex.Installations)
	}
	if !reflect.DeepEqual(listedAgain.Installations, canonicalCodex.Installations) {
		t.Fatalf("ListHarnesses() installations for codex = %#v, want %#v", listedAgain.Installations, canonicalCodex.Installations)
	}
	assertNoInstallationMutationMarker(t, "GetHarnessMatrix", matrixAgain.Installations)
	assertNoInstallationMutationMarker(t, "ListHarnesses", listedAgain.Installations)
}

func TestSupportAPIsExposeDefensiveSupportClones(t *testing.T) {
	canonical := GetRawHarnessData()
	canonicalCodex := findHarnessDefinition(t, canonical.Harnesses, "codex")
	first, err := GetHarnessSupport("codex")
	if err != nil {
		t.Fatalf("GetHarnessSupport(codex): %v", err)
	}
	second, err := GetHarnessSupport("codex")
	if err != nil {
		t.Fatalf("GetHarnessSupport(codex) second call: %v", err)
	}
	listed := ListHarnessSupport()
	listedCodex := findHarnessSupportRecord(t, listed, "codex")

	first.Support.Config.Global.Paths = append(first.Support.Config.Global.Paths, HarnessSupportPath{ID: "MUTATED", Kind: "file", Template: "MUTATED", Description: "MUTATED"})
	first.Support.Config.Global.Sources = append(first.Support.Config.Global.Sources, "https://example.com")
	first.Support.Config.Global.Status = "unsupported"
	first.Support.Config.Global.Confidence = "unknown"
	listedCodex.Support.Config.Local.Paths = append(listedCodex.Support.Config.Local.Paths, HarnessSupportPath{ID: "MUTATED-LOCAL", Kind: "dir", Template: "MUTATED"})
	mutateSupportPathSliceExtraCapacity(first.Support.Config.Global.Paths, HarnessSupportPath{ID: "MUTATED", Kind: "file", Template: "MUTATED", Description: "MUTATED"})
	mutateStringSliceExtraCapacity(first.Support.Config.Global.Sources, "https://example.com")
	mutateSupportPathSliceExtraCapacity(listedCodex.Support.Config.Local.Paths, HarnessSupportPath{ID: "MUTATED-LOCAL", Kind: "dir", Template: "MUTATED"})

	third, err := GetHarnessSupport("codex")
	if err != nil {
		t.Fatalf("GetHarnessSupport(codex) third call: %v", err)
	}
	listedAgain := findHarnessSupportRecord(t, ListHarnessSupport(), "codex")

	if !reflect.DeepEqual(second.Support, canonicalCodex.Support) {
		t.Fatalf("GetHarnessSupport() support = %#v, want %#v", second.Support, canonicalCodex.Support)
	}
	if !reflect.DeepEqual(third.Support, canonicalCodex.Support) {
		t.Fatalf("mutating prior GetHarnessSupport() data affected later call: got %#v want %#v", third.Support, canonicalCodex.Support)
	}
	if !reflect.DeepEqual(listedAgain.Support, canonicalCodex.Support) {
		t.Fatalf("ListHarnessSupport() support = %#v, want %#v", listedAgain.Support, canonicalCodex.Support)
	}
	assertHarnessSupportNotMutated(t, "GetHarnessSupport", third.Support)
	assertHarnessSupportNotMutated(t, "ListHarnessSupport", listedAgain.Support)
	assertHarnessSupportNotMutated(t, "GetRawHarnessData", canonicalCodex.Support)
}

func TestGetRawHarnessData_MatchesGetHarnessMatrix(t *testing.T) {
	raw := GetRawHarnessData()
	compat := GetHarnessMatrix()

	if raw.Version != compat.Version {
		t.Fatalf("version mismatch: raw=%d compat=%d", raw.Version, compat.Version)
	}
	if len(raw.Harnesses) != len(compat.Harnesses) {
		t.Fatalf("harness count mismatch: raw=%d compat=%d", len(raw.Harnesses), len(compat.Harnesses))
	}
	if len(raw.Harnesses) == 0 {
		t.Fatal("expected embedded harness data")
	}
	if raw.Harnesses[0].Key != compat.Harnesses[0].Key {
		t.Fatalf("first harness mismatch: raw=%q compat=%q", raw.Harnesses[0].Key, compat.Harnesses[0].Key)
	}
}

func TestGetRawHarnessData_IsDefensiveCopy(t *testing.T) {
	first := GetRawHarnessData()
	second := GetRawHarnessData()

	first.Version = 99
	first.Harnesses[0].Key = "mutated-key"
	first.Harnesses[0].Aliases = append(first.Harnesses[0].Aliases, "MUTATED")
	first.Harnesses[0].Executables = append(first.Harnesses[0].Executables, "MUTATED")
	first.Harnesses[0].Paths = append(first.Harnesses[0].Paths, HarnessPathSpec{ID: "MUTATED"})
	first.Harnesses[0].Roots = append(first.Harnesses[0].Roots, HarnessRootDef{Name: "MUTATED"})
	first.Harnesses[0].Support = HarnessSupport{}
	first.Harnesses[0].Env = append(first.Harnesses[0].Env, HarnessEnvVar{Name: "MUTATED", Description: "MUTATED"})
	first.Harnesses[0].Sources = append(first.Harnesses[0].Sources, "MUTATED")
	first.Harnesses[0].Installations = append(first.Harnesses[0].Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED"})
	first.Harnesses = append(first.Harnesses, HarnessDefinition{Key: "MUTATED"})
	mutateStringSliceExtraCapacity(first.Harnesses[0].Aliases, "MUTATED")
	mutateStringSliceExtraCapacity(first.Harnesses[0].Executables, "MUTATED")
	mutatePathSpecSliceExtraCapacity(first.Harnesses[0].Paths, HarnessPathSpec{ID: "MUTATED", Template: "MUTATED"})
	mutateEnvVarSliceExtraCapacity(first.Harnesses[0].Env, HarnessEnvVar{Name: "MUTATED", Description: "MUTATED"})
	mutateStringSliceExtraCapacity(first.Harnesses[0].Sources, "MUTATED")
	mutateInstallationSliceExtraCapacity(first.Harnesses[0].Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED"})
	mutateHarnessSliceExtraCapacity(first.Harnesses, HarnessDefinition{Key: "MUTATED"})

	claude := findHarnessDefinition(t, first.Harnesses, "claude-code")
	claude.Installations[0].Platforms[0] = "MUTATED"
	claude.Installations[0].Platforms = append(claude.Installations[0].Platforms, "MUTATED")
	mutateStringSliceExtraCapacity(claude.Installations[0].Platforms, "MUTATED")

	cursor := findHarnessDefinition(t, first.Harnesses, "cursor")
	cursor.Paths[0].Platforms[0] = "MUTATED"
	cursor.Paths[0].Platforms = append(cursor.Paths[0].Platforms, "MUTATED")
	mutateStringSliceExtraCapacity(cursor.Paths[0].Platforms, "MUTATED")

	if second.Version != 1 {
		t.Fatalf("second.Version = %d, want 1", second.Version)
	}
	if len(second.Harnesses) == 0 {
		t.Fatal("expected embedded harness data")
	}
	if second.Harnesses[0].Key == "mutated-key" {
		t.Fatal("GetRawHarnessData reused struct data from a previous call")
	}
	for i, v := range second.Harnesses[0].Aliases[:cap(second.Harnesses[0].Aliases)] {
		if v == "MUTATED" {
			t.Fatalf("Aliases aliases embedded registry backing array at position %d", i)
		}
	}
	for i, v := range second.Harnesses[0].Executables[:cap(second.Harnesses[0].Executables)] {
		if v == "MUTATED" {
			t.Fatalf("Executables aliases embedded registry backing array at position %d", i)
		}
	}
	for i, p := range second.Harnesses[0].Paths[:cap(second.Harnesses[0].Paths)] {
		if p.ID == "MUTATED" {
			t.Fatalf("Paths aliases embedded registry backing array at position %d", i)
		}
	}
	for i, r := range second.Harnesses[0].Roots[:cap(second.Harnesses[0].Roots)] {
		if r.Name == "MUTATED" {
			t.Fatalf("Roots aliases embedded registry backing array at position %d", i)
		}
	}
	for i, e := range second.Harnesses[0].Env[:cap(second.Harnesses[0].Env)] {
		if e.Name == "MUTATED" {
			t.Fatalf("Env aliases embedded registry backing array at position %d", i)
		}
	}
	for i, v := range second.Harnesses[0].Sources[:cap(second.Harnesses[0].Sources)] {
		if v == "MUTATED" {
			t.Fatalf("Sources aliases embedded registry backing array at position %d", i)
		}
	}
	for i, installation := range second.Harnesses[0].Installations[:cap(second.Harnesses[0].Installations)] {
		if installation.Method == "MUTATED" || installation.Notes == "MUTATED" {
			t.Fatalf("Installations aliases embedded registry backing array at position %d", i)
		}
	}
	for i, h := range second.Harnesses[:cap(second.Harnesses)] {
		if h.Key == "MUTATED" {
			t.Fatalf("Harnesses aliases embedded registry backing array at position %d", i)
		}
	}
	assertHarnessDefinitionNotMutated(t, "GetRawHarnessData", findHarnessDefinition(t, second.Harnesses, "claude-code"))
	assertHarnessDefinitionNotMutated(t, "GetRawHarnessData", findHarnessDefinition(t, second.Harnesses, "cursor"))
}

func TestListHarnesses(t *testing.T) {
	matrix := GetHarnessMatrix()
	harnesses := ListHarnesses()
	if len(harnesses) != len(matrix.Harnesses) {
		t.Fatalf("list length mismatch: got %d, want %d", len(harnesses), len(matrix.Harnesses))
	}
}

func TestCheckHarness_ResolvesEnvOverrides(t *testing.T) {
	result, err := CheckHarness("codex", CheckOptions{
		CWD: "/repo",
		Env: map[string]string{
			"HOME":       "/Users/test",
			"CODEX_HOME": "/tmp/codex-home",
			"PATH":       "",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	config := findPath(result, "config")
	project := findPath(result, "project-config")

	if config == nil {
		t.Fatal("missing config path")
	}
	if project == nil {
		t.Fatal("missing project-config path")
	}
	if config.Path == nil || *config.Path != "/tmp/codex-home/config.toml" {
		t.Fatalf("config path = %v, want %q", config.Path, "/tmp/codex-home/config.toml")
	}
	if project.Path == nil || *project.Path != "/repo/.codex/config.toml" {
		t.Fatalf("project-config path = %v, want %q", project.Path, "/repo/.codex/config.toml")
	}
}

func TestCheckHarness_IgnoresEnvCWDWhenOptionUnset(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{
			"HOME": "/Users/test",
			"CWD":  "/wrong",
			"PATH": "",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	project := findPath(result, "project-config")
	if project == nil {
		t.Fatal("missing project-config path")
	}
	want := filepath.Join(wd, ".codex", "config.toml")
	if project.Path == nil || *project.Path != want {
		t.Fatalf("project-config path = %v, want %q (and not /wrong/.codex/config.toml)", project.Path, want)
	}
}

func TestCheckHarness_ProcessPATHVisibleOnlyWhenEnvNil(t *testing.T) {
	exePath, binDir := writeTempCodexExecutable(t)
	t.Setenv("PATH", binDir)

	result, err := CheckHarness("codex", CheckOptions{})
	if err != nil {
		t.Fatalf("CheckHarness with default options: %v", err)
	}
	if result.ExecutablePath == nil || *result.ExecutablePath != exePath {
		t.Fatalf("default options executable path = %v, want %q", result.ExecutablePath, exePath)
	}
	if !result.Installed {
		t.Fatal("expected installed from process PATH when Env is nil")
	}
}

func TestCheckHarness_ProcessPATHIgnoredWhenEnvExplicit(t *testing.T) {
	exePath, binDir := writeTempCodexExecutable(t)
	t.Setenv("PATH", binDir)

	withExplicitEnv, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("CheckHarness with explicit env: %v", err)
	}
	if withExplicitEnv.ExecutablePath != nil {
		t.Fatalf("explicit env executable path = %v, want nil (process PATH should not resolve %q)", withExplicitEnv.ExecutablePath, exePath)
	}
}

func TestConcurrentRegistryAccessAndChecks(t *testing.T) {
	const workers = 8
	const iterations = 25

	tmp := tempDir(t)
	var wg sync.WaitGroup
	errCh := make(chan error, workers)

	for worker := range workers {
		worker := worker
		wg.Add(1)
		go func() {
			defer wg.Done()

			home := filepath.Join(tmp, fmt.Sprintf("home-%d", worker))
			binDir := filepath.Join(tmp, fmt.Sprintf("bin-%d", worker))
			cwd := filepath.Join(tmp, fmt.Sprintf("repo-%d", worker))

			if err := os.MkdirAll(home, 0o755); err != nil {
				errCh <- fmt.Errorf("worker %d mkdir home: %w", worker, err)
				return
			}
			if err := os.MkdirAll(binDir, 0o755); err != nil {
				errCh <- fmt.Errorf("worker %d mkdir bin: %w", worker, err)
				return
			}
			if err := os.MkdirAll(cwd, 0o755); err != nil {
				errCh <- fmt.Errorf("worker %d mkdir cwd: %w", worker, err)
				return
			}

			exePath := filepath.Join(binDir, "codex")
			mode := os.FileMode(0o755)
			if runtime.GOOS == "windows" {
				exePath += ".exe"
				mode = 0o644
			}
			if err := os.WriteFile(exePath, []byte("#!/bin/sh\nexit 0\n"), mode); err != nil {
				errCh <- fmt.Errorf("worker %d write exe: %w", worker, err)
				return
			}

			for iteration := range iterations {
				raw := GetRawHarnessData()
				if len(raw.Harnesses) == 0 {
					errCh <- fmt.Errorf("worker %d iteration %d raw harnesses empty", worker, iteration)
					return
				}

				list := ListHarnesses()
				if len(list) != len(raw.Harnesses) {
					errCh <- fmt.Errorf("worker %d iteration %d list len=%d want %d", worker, iteration, len(list), len(raw.Harnesses))
					return
				}

				support, err := GetHarnessSupport("codex")
				if err != nil {
					errCh <- fmt.Errorf("worker %d iteration %d GetHarnessSupport: %w", worker, iteration, err)
					return
				}
				if support.Key != "codex" {
					errCh <- fmt.Errorf("worker %d iteration %d support key=%q want codex", worker, iteration, support.Key)
					return
				}

				result, err := CheckHarness("codex", CheckOptions{
					Env: map[string]string{
						"HOME":       home,
						"CODEX_HOME": home,
						"PATH":       binDir,
					},
					CWD: cwd,
				})
				if err != nil {
					errCh <- fmt.Errorf("worker %d iteration %d CheckHarness: %w", worker, iteration, err)
					return
				}
				if !result.Installed {
					errCh <- fmt.Errorf("worker %d iteration %d expected installed", worker, iteration)
					return
				}
				if result.ExecutablePath == nil || *result.ExecutablePath != exePath {
					errCh <- fmt.Errorf("worker %d iteration %d executable=%v want %q", worker, iteration, result.ExecutablePath, exePath)
					return
				}
				project := findPath(result, "project-config")
				wantProject := filepath.Join(cwd, ".codex", "config.toml")
				if project == nil || project.Path == nil || *project.Path != wantProject {
					errCh <- fmt.Errorf("worker %d iteration %d project-config=%v want %q", worker, iteration, project, wantProject)
					return
				}
			}
		}()
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func writeTempCodexExecutable(t *testing.T) (string, string) {
	t.Helper()

	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(binDir, "codex")
	mode := os.FileMode(0o755)
	if runtime.GOOS == "windows" {
		exePath += ".exe"
		mode = 0o644
	}
	if err := os.WriteFile(exePath, []byte("#!/bin/sh\nexit 0\n"), mode); err != nil {
		t.Fatalf("write file: %v", err)
	}

	return exePath, binDir
}

func TestCheckHarness_ResolvesDerivedRoots(t *testing.T) {
	result, err := CheckHarness("hermes-agent", CheckOptions{
		CWD: "/repo",
		Env: map[string]string{
			"HOME":        "/Users/test",
			"HERMES_HOME": "/tmp/hermes-home",
			"PATH":        "",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	config := findPath(result, "config")
	sessions := findPath(result, "sessions")

	if config == nil || config.Path == nil || *config.Path != "/tmp/hermes-home/config.yaml" {
		t.Fatalf("config path = %v, want /tmp/hermes-home/config.yaml", config)
	}
	if sessions == nil || sessions.Path == nil || *sessions.Path != "/tmp/hermes-home/sessions" {
		t.Fatalf("sessions path = %v, want /tmp/hermes-home/sessions", sessions)
	}
}

func TestCheckHarness_AliasesMatch(t *testing.T) {
	byKey, err := CheckHarness("claude-code", CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("byKey error: %v", err)
	}

	byAlias, err := CheckHarness("claude", CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("byAlias error: %v", err)
	}

	if byKey.Key != byAlias.Key {
		t.Fatalf("alias mismatch: %q vs %q", byKey.Key, byAlias.Key)
	}
}

func TestDetectHarnesses_ChecksAll(t *testing.T) {
	all, err := DetectHarnesses(CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(all) != len(ListHarnesses()) {
		t.Fatalf("detected %d, want %d", len(all), len(ListHarnesses()))
	}
}

func TestDetectInstalledHarnesses_OnlyInstalled(t *testing.T) {
	tmp := tempDir(t)
	claudeDir := filepath.Join(tmp, ".claude")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	options := CheckOptions{
		Env: map[string]string{"HOME": tmp, "PATH": ""},
		CWD: "/repo",
	}

	installed, err := DetectInstalledHarnesses(options)
	if err != nil {
		t.Fatalf("detect installed: %v", err)
	}
	all, err := DetectHarnesses(options)
	if err != nil {
		t.Fatalf("detect all: %v", err)
	}
	installedViaFilter := make([]HarnessCheckResult, 0, len(all))
	for _, r := range all {
		if r.Installed {
			installedViaFilter = append(installedViaFilter, r)
		}
	}
	if len(installed) != len(installedViaFilter) {
		t.Fatalf("installed length = %d, want %d (via filter)", len(installed), len(installedViaFilter))
	}
	for _, r := range installed {
		if !r.Installed {
			t.Fatalf("result %q has Installed=false in DetectInstalledHarnesses output", r.Key)
		}
	}
	sawClaude := false
	for _, r := range installed {
		if r.Key == "claude-code" {
			sawClaude = true
			break
		}
	}
	if !sawClaude {
		t.Fatal("claude-code should be installed in this fixture")
	}
}

func TestCheckHarness_Unknown(t *testing.T) {
	_, err := CheckHarness("nonexistent-harness", CheckOptions{})
	if err == nil {
		t.Fatal("expected error for unknown harness")
	}
	if err.Error() != "Unknown harness: nonexistent-harness" {
		t.Fatalf("unexpected error message: %q", err.Error())
	}
}

func TestCheckHarness_UnresolvedPlaceholder(t *testing.T) {
	result, err := CheckHarness("amazon-q-cli", CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dataRoot := findPath(result, "data-root-env")
	if dataRoot == nil {
		t.Fatal("missing data-root-env")
	}
	if dataRoot.Path != nil {
		t.Fatalf("expected nil path, got %v", dataRoot.Path)
	}
	if dataRoot.Exists {
		t.Fatal("expected exists = false")
	}

	jsonBytes, err := json.Marshal(dataRoot)
	if err != nil {
		t.Fatalf("marshal unresolved path: %v", err)
	}
	if !strings.Contains(string(jsonBytes), `"path":null`) {
		t.Fatalf("expected marshaled JSON to contain %q, got %s", `"path":null`, jsonBytes)
	}
}

func TestCheckHarness_PlatformGated(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("darwin-only test")
	}

	result, err := CheckHarness("cursor", CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	appMacos := findPath(result, "app-macos")
	if appMacos == nil {
		t.Fatal("missing app-macos entry on darwin")
	}
	if appMacos.Path == nil || *appMacos.Path != "/Applications/Cursor.app" {
		t.Fatalf("app-macos path = %v, want %q", appMacos.Path, "/Applications/Cursor.app")
	}
}

func TestCheckHarness_PathMatchInstalls(t *testing.T) {
	tmp := tempDir(t)
	claudeDir := filepath.Join(tmp, ".claude")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("claude-code", CheckOptions{
		Env: map[string]string{"HOME": tmp, "PATH": ""},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.Installed {
		t.Fatal("expected installed")
	}
	if result.ExecutablePath != nil {
		t.Fatalf("expected no executable match, got %v", result.ExecutablePath)
	}
	if len(result.MatchedPaths) == 0 {
		t.Fatal("expected matched paths")
	}
	settings := findPath(result, "settings")
	if settings == nil || !settings.Exists {
		t.Fatal("settings should exist")
	}
}

func TestCheckHarness_ExecutableMatchInstalls(t *testing.T) {
	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(binDir, "codex")
	if err := os.WriteFile(exePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": binDir},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.Installed {
		t.Fatal("expected installed from executable match")
	}
	if result.ExecutablePath == nil || *result.ExecutablePath != exePath {
		t.Fatalf("executable path = %v, want %q", result.ExecutablePath, exePath)
	}
}

func TestCheckHarness_NonExecutableDoesNotMatch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix-only test")
	}

	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(binDir, "codex")
	if err := os.WriteFile(exePath, []byte("#!/bin/sh\nexit 0\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{"HOME": tmp, "PATH": binDir},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Installed {
		t.Fatal("non-executable file should not count as installed")
	}
	if result.ExecutablePath != nil {
		t.Fatalf("expected no executable match, got %v", result.ExecutablePath)
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if !strings.Contains(string(jsonBytes), `"executablePath":null`) {
		t.Fatalf("expected marshaled JSON to contain %q, got %s", `"executablePath":null`, jsonBytes)
	}
}

func TestCheckHarness_ReasonsAndMatchedPaths(t *testing.T) {
	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(binDir, "codex")
	if err := os.WriteFile(exePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write file: %v", err)
	}

	codexHome := filepath.Join(tmp, "codex-home")
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(""), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{"HOME": tmp, "CODEX_HOME": codexHome, "PATH": binDir},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.Installed {
		t.Fatal("expected installed")
	}
	if !slices.Contains(result.Reasons, "executable:codex") {
		t.Fatalf("missing executable reason, got %v", result.Reasons)
	}
	if !slices.Contains(result.Reasons, "config:config") {
		t.Fatalf("missing config reason, got %v", result.Reasons)
	}

	config := findPath(result, "config")
	if config == nil || !config.Exists {
		t.Fatal("config path should be matched")
	}
	wantConfig := filepath.Join(codexHome, "config.toml")
	if config.Path == nil || *config.Path != wantConfig {
		t.Fatalf("config path = %v, want %q", config.Path, wantConfig)
	}
}

func findPath(result HarnessCheckResult, id string) *ResolvedHarnessPath {
	for i := range result.Paths {
		if result.Paths[i].ID == id {
			return &result.Paths[i]
		}
	}
	return nil
}

func assertHarnessDefinitionNotMutated(t *testing.T, label string, harness HarnessDefinition) {
	t.Helper()

	for i, alias := range harness.Aliases[:cap(harness.Aliases)] {
		if alias == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Aliases at backing array position %d", label, i)
		}
	}
	for i, executable := range harness.Executables[:cap(harness.Executables)] {
		if executable == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Executables at backing array position %d", label, i)
		}
	}
	for i, path := range harness.Paths[:cap(harness.Paths)] {
		if path.ID == "MUTATED" || path.Template == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Paths at backing array position %d", label, i)
		}
		for j, platform := range path.Platforms[:cap(path.Platforms)] {
			if platform == "MUTATED" {
				t.Fatalf("%s aliases mutated Harness.Paths[%d].Platforms at backing array position %d", label, i, j)
			}
		}
	}
	for i, envVar := range harness.Env[:cap(harness.Env)] {
		if envVar.Name == "MUTATED" || envVar.Description == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Env at backing array position %d", label, i)
		}
	}
	assertHarnessSupportNotMutated(t, label, harness.Support)
	for i, source := range harness.Sources[:cap(harness.Sources)] {
		if source == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Sources at backing array position %d", label, i)
		}
	}
	for i, installation := range harness.Installations[:cap(harness.Installations)] {
		if installation.Method == "MUTATED" || installation.Package == "MUTATED" || installation.Command == "MUTATED" || installation.URL == "MUTATED" || installation.Marketplace == "MUTATED" || installation.ID == "MUTATED" || installation.Notes == "MUTATED" {
			t.Fatalf("%s aliases mutated Harness.Installations at backing array position %d", label, i)
		}
		for j, platform := range installation.Platforms[:cap(installation.Platforms)] {
			if platform == "MUTATED" {
				t.Fatalf("%s aliases mutated Harness.Installations[%d].Platforms at backing array position %d", label, i, j)
			}
		}
	}
}

func assertHarnessSupportNotMutated(t *testing.T, label string, support HarnessSupport) {
	t.Helper()
	for _, area := range []struct {
		name string
		area HarnessSupportArea
	}{
		{name: "config", area: support.Config},
		{name: "skills", area: support.Skills},
		{name: "commands", area: support.Commands},
		{name: "agents", area: support.Agents},
		{name: "dotAgents", area: support.DotAgents},
	} {
		assertHarnessSupportScopeNotMutated(t, label, area.name, "global", area.area.Global)
		assertHarnessSupportScopeNotMutated(t, label, area.name, "local", area.area.Local)
	}
}

func assertHarnessSupportScopeNotMutated(t *testing.T, label, area, scope string, support HarnessSupportScope) {
	t.Helper()
	if support.Status == "MUTATED" || support.Confidence == "MUTATED" || support.Notes == "MUTATED" {
		t.Fatalf("%s aliases mutated support %s.%s scalar fields", label, area, scope)
	}
	for i, source := range support.Sources[:cap(support.Sources)] {
		if source == "MUTATED" || source == "https://example.com" {
			t.Fatalf("%s aliases mutated support %s.%s sources at backing array position %d", label, area, scope, i)
		}
	}
	for i, path := range support.Paths[:cap(support.Paths)] {
		if path.ID == "MUTATED" || path.ID == "MUTATED-LOCAL" || path.Kind == "MUTATED" || path.Template == "MUTATED" || path.Description == "MUTATED" {
			t.Fatalf("%s aliases mutated support %s.%s paths at backing array position %d", label, area, scope, i)
		}
		for j, platform := range path.Platforms[:cap(path.Platforms)] {
			if platform == "MUTATED" || platform == "plan9" {
				t.Fatalf("%s aliases mutated support %s.%s path platforms at backing array position %d/%d", label, area, scope, i, j)
			}
		}
	}
}

func TestCheckHarness_ResultIsMutationSafe(t *testing.T) {
	options := CheckOptions{
		Env: map[string]string{"HOME": "/Users/test", "PATH": ""},
		CWD: "/repo",
	}

	first, err := CheckHarness("claude-code", options)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	platformResult, err := CheckHarness("cursor", options)
	if err != nil {
		t.Fatalf("platform call: %v", err)
	}

	// Mutate every slice-shaped field on the first result.
	if len(first.Harness.Aliases) == 0 || len(first.Harness.Executables) == 0 || len(first.Harness.Paths) == 0 || len(first.Harness.Env) == 0 || len(first.Harness.Sources) == 0 || len(first.Harness.Installations) == 0 || len(first.Harness.Installations[0].Platforms) == 0 {
		t.Fatal("claude-code fixture must populate aliases, executables, paths, env, sources, installations, and installation platforms")
	}
	if len(platformResult.Harness.Paths) == 0 || len(platformResult.Harness.Paths[0].Platforms) == 0 {
		t.Fatal("cursor fixture must populate platform-gated paths")
	}
	first.Harness.Aliases[0] = "MUTATED"
	first.Harness.Executables[0] = "MUTATED"
	first.Harness.Paths[0] = HarnessPathSpec{ID: "MUTATED", Template: "MUTATED"}
	first.Harness.Env[0] = HarnessEnvVar{Name: "MUTATED", Description: "MUTATED"}
	first.Harness.Sources[0] = "MUTATED"
	first.Harness.Installations[0] = HarnessInstallation{Method: "MUTATED", Notes: "MUTATED", Platforms: []string{"MUTATED"}}
	first.Harness.Aliases = append(first.Harness.Aliases, "MUTATED")
	first.Harness.Executables = append(first.Harness.Executables, "MUTATED")
	first.Harness.Paths = append(first.Harness.Paths, HarnessPathSpec{ID: "MUTATED", Template: "MUTATED"})
	first.Harness.Env = append(first.Harness.Env, HarnessEnvVar{Name: "MUTATED", Description: "MUTATED"})
	first.Harness.Sources = append(first.Harness.Sources, "MUTATED")
	first.Harness.Installations = append(first.Harness.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED", Platforms: []string{"MUTATED"}})
	first.Paths = append(first.Paths, ResolvedHarnessPath{HarnessPathSpec: HarnessPathSpec{ID: "MUTATED"}})
	first.MatchedPaths = append(first.MatchedPaths, ResolvedHarnessPath{HarnessPathSpec: HarnessPathSpec{ID: "MUTATED"}})
	first.Reasons = append(first.Reasons, "MUTATED")
	mutateStringSliceExtraCapacity(first.Harness.Aliases, "MUTATED")
	mutateStringSliceExtraCapacity(first.Harness.Executables, "MUTATED")
	mutatePathSpecSliceExtraCapacity(first.Harness.Paths, HarnessPathSpec{ID: "MUTATED", Template: "MUTATED"})
	mutateEnvVarSliceExtraCapacity(first.Harness.Env, HarnessEnvVar{Name: "MUTATED", Description: "MUTATED"})
	mutateStringSliceExtraCapacity(first.Harness.Sources, "MUTATED")
	mutateInstallationSliceExtraCapacity(first.Harness.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED"})
	mutateResolvedPathSliceExtraCapacity(first.Paths, ResolvedHarnessPath{HarnessPathSpec: HarnessPathSpec{ID: "MUTATED"}})
	mutateResolvedPathSliceExtraCapacity(first.MatchedPaths, ResolvedHarnessPath{HarnessPathSpec: HarnessPathSpec{ID: "MUTATED"}})
	mutateStringSliceExtraCapacity(first.Reasons, "MUTATED")

	platformResult.Harness.Paths[0].Platforms[0] = "MUTATED"
	platformResult.Harness.Paths[0].Platforms = append(platformResult.Harness.Paths[0].Platforms, "MUTATED")
	mutateStringSliceExtraCapacity(platformResult.Harness.Paths[0].Platforms, "MUTATED")

	second, err := CheckHarness("claude-code", options)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	platformSecond, err := CheckHarness("cursor", options)
	if err != nil {
		t.Fatalf("platform second call: %v", err)
	}
	harnesses := ListHarnesses()
	raw := GetRawHarnessData()
	matrix := GetHarnessMatrix()
	listClaude := findHarnessDefinition(t, harnesses, "claude-code")
	matrixClaude := findHarnessDefinition(t, matrix.Harnesses, "claude-code")

	listClaude.Installations[0].Platforms[0] = "MUTATED"
	listClaude.Installations = append(listClaude.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED", Platforms: []string{"MUTATED"}})
	matrixClaude.Installations[0].Platforms[0] = "MUTATED"
	matrixClaude.Installations = append(matrixClaude.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED", Platforms: []string{"MUTATED"}})
	mutateInstallationSliceExtraCapacity(listClaude.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED"})
	mutateInstallationSliceExtraCapacity(matrixClaude.Installations, HarnessInstallation{Method: "MUTATED", Notes: "MUTATED"})
	mutateStringSliceExtraCapacity(listClaude.Installations[0].Platforms, "MUTATED")
	mutateStringSliceExtraCapacity(matrixClaude.Installations[0].Platforms, "MUTATED")

	harnessesAgain := ListHarnesses()
	matrixAgain := GetHarnessMatrix()

	assertHarnessDefinitionNotMutated(t, "CheckHarness", second.Harness)
	assertHarnessDefinitionNotMutated(t, "CheckHarness", platformSecond.Harness)
	if len(harnessesAgain) == 0 {
		t.Fatal("ListHarnesses returned no harnesses")
	}
	if len(raw.Harnesses) == 0 {
		t.Fatal("GetRawHarnessData returned no harnesses")
	}
	assertHarnessDefinitionNotMutated(t, "GetRawHarnessData", findHarnessDefinition(t, raw.Harnesses, "claude-code"))
	assertHarnessDefinitionNotMutated(t, "GetRawHarnessData", findHarnessDefinition(t, raw.Harnesses, "cursor"))
	assertHarnessDefinitionNotMutated(t, "ListHarnesses", findHarnessDefinition(t, harnessesAgain, "claude-code"))
	assertHarnessDefinitionNotMutated(t, "ListHarnesses", findHarnessDefinition(t, harnessesAgain, "cursor"))
	assertHarnessDefinitionNotMutated(t, "GetHarnessMatrix", findHarnessDefinition(t, matrixAgain.Harnesses, "claude-code"))
	assertHarnessDefinitionNotMutated(t, "GetHarnessMatrix", findHarnessDefinition(t, matrixAgain.Harnesses, "cursor"))

	for i, p := range second.Paths[:cap(second.Paths)] {
		if p.ID == "MUTATED" {
			t.Fatalf("Paths aliases an internal slice at backing array position %d", i)
		}
	}
	for i, p := range second.MatchedPaths[:cap(second.MatchedPaths)] {
		if p.ID == "MUTATED" {
			t.Fatalf("MatchedPaths aliases an internal slice at backing array position %d", i)
		}
	}
	for i, r := range second.Reasons[:cap(second.Reasons)] {
		if r == "MUTATED" {
			t.Fatalf("Reasons aliases an internal slice at backing array position %d", i)
		}
	}
}

func findHarnessDefinition(t *testing.T, harnesses []HarnessDefinition, key string) HarnessDefinition {
	t.Helper()
	for _, harness := range harnesses {
		if harness.Key == key {
			return harness
		}
	}
	t.Fatalf("missing harness %q", key)
	return HarnessDefinition{}
}

func mutateStringSliceExtraCapacity(slice []string, value string) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutatePathSpecSliceExtraCapacity(slice []HarnessPathSpec, value HarnessPathSpec) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutateEnvVarSliceExtraCapacity(slice []HarnessEnvVar, value HarnessEnvVar) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutateInstallationSliceExtraCapacity(slice []HarnessInstallation, value HarnessInstallation) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutateSupportPathSliceExtraCapacity(slice []HarnessSupportPath, value HarnessSupportPath) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutateHarnessSliceExtraCapacity(slice []HarnessDefinition, value HarnessDefinition) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func mutateResolvedPathSliceExtraCapacity(slice []ResolvedHarnessPath, value ResolvedHarnessPath) {
	if cap(slice) > len(slice) {
		slice[:cap(slice)][len(slice)] = value
	}
}

func findHarnessSupportRecord(t *testing.T, records []HarnessSupportRecord, key string) HarnessSupportRecord {
	t.Helper()
	for _, record := range records {
		if record.Key == key {
			return record
		}
	}
	t.Fatalf("missing harness support record %q", key)
	return HarnessSupportRecord{}
}

func TestFindExecutable_WindowsExe(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only test")
	}
	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(binDir, "codex.exe")
	if err := os.WriteFile(exePath, []byte(""), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{
			"HOME":    "/Users/test",
			"PATH":    binDir,
			"PATHEXT": ".EXE;.CMD;.BAT;.COM",
		},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !result.Installed {
		t.Fatal("expected installed from .exe match")
	}
	if result.ExecutablePath == nil || *result.ExecutablePath != exePath {
		t.Fatalf("executable path = %v, want %q", result.ExecutablePath, exePath)
	}
}

func TestFindExecutable_WindowsBat(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only test")
	}
	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	batPath := filepath.Join(binDir, "codex.bat")
	if err := os.WriteFile(batPath, []byte(""), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{
			"HOME":    "/Users/test",
			"PATH":    binDir,
			"PATHEXT": ".EXE;.CMD;.BAT;.COM",
		},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !result.Installed {
		t.Fatal("expected installed from .bat match")
	}
	if result.ExecutablePath == nil || *result.ExecutablePath != batPath {
		t.Fatalf("executable path = %v, want %q", result.ExecutablePath, batPath)
	}
}

func TestFindExecutable_WindowsNoMatch(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only test")
	}
	tmp := tempDir(t)
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "codex"), []byte(""), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	result, err := CheckHarness("codex", CheckOptions{
		Env: map[string]string{
			"HOME":    "/Users/test",
			"PATH":    binDir,
			"PATHEXT": ".EXE",
		},
		CWD: "/repo",
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.Installed {
		t.Fatal("expected not installed when no PATHEXT match")
	}
	if result.ExecutablePath != nil {
		t.Fatalf("expected no executable match, got %v", result.ExecutablePath)
	}
}

func TestRegistryValidatesAgainstSchema(t *testing.T) {
	schemaPath := filepath.Join("..", "..", "data", "harnesses.schema.json")
	if _, err := os.Stat(schemaPath); err != nil {
		t.Fatalf("schema not found at %s: %v", schemaPath, err)
	}
	canonical := filepath.Join("..", "..", "data", "harnesses.json")
	data, err := os.ReadFile(canonical)
	if err != nil {
		t.Fatalf("read canonical: %v", err)
	}
	var matrix struct {
		Version   int                      `json:"version"`
		Harnesses []map[string]interface{} `json:"harnesses"`
	}
	if err := json.Unmarshal(data, &matrix); err != nil {
		t.Fatalf("parse canonical: %v", err)
	}
	if matrix.Version != 1 {
		t.Fatalf("version = %d, want 1", matrix.Version)
	}
	if len(matrix.Harnesses) < 10 {
		t.Fatalf("harnesses length = %d, want >= 10", len(matrix.Harnesses))
	}
	schema := readJSONFile(t, schemaPath)

	keyRe := regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	rootNameRe := regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)
	categories := map[string]bool{"install": true, "config": true, "state": true, "cache": true, "project": true}
	kinds := map[string]bool{"file": true, "dir": true}
	platformValues := map[string]bool{"aix": true, "android": true, "cygwin": true, "darwin": true, "freebsd": true, "haiku": true, "linux": true, "netbsd": true, "openbsd": true, "sunos": true, "win32": true}
	supportStatusValues := sliceSet(supportStatuses)
	supportConfidenceValues := sliceSet(supportConfidenceLevels)
	seen := map[string]bool{}
	hasUnknownInstall := false
	codexNpmInstall := false

	for _, defName := range []string{"HarnessSupport", "HarnessSupportArea", "HarnessSupportScope", "HarnessSupportPath"} {
		defs, ok := mustObject(t, schema["$defs"], "$defs")
		if !ok || defs[defName] == nil {
			t.Fatalf("schema must define $defs.%s", defName)
		}
	}

	// validateTemplate checks that every ${...} in the template contains a
	// valid uppercase identifier. Go's regexp (RE2) does not support
	// lookahead, so we scan for ${...} and verify the contents instead.
	validateTemplate := func(s string) bool {
		for i := 0; i < len(s); i++ {
			if s[i] == '$' && i+1 < len(s) && s[i+1] == '{' {
				end := -1
				for j := i + 2; j < len(s); j++ {
					if s[j] == '}' {
						end = j
						break
					}
				}
				if end == -1 {
					return false // unclosed ${
				}
				inner := s[i+2 : end]
				if !rootNameRe.MatchString(inner) {
					return false // invalid identifier inside ${...}
				}
				i = end
			}
		}
		return true
	}

	for _, h := range matrix.Harnesses {
		key, _ := h["key"].(string)
		if seen[key] {
			t.Fatalf("duplicate key: %s", key)
		}
		seen[key] = true
		if !keyRe.MatchString(key) {
			t.Fatalf("key %q does not match ^[a-z][a-z0-9-]*$", key)
		}
		if name, _ := h["name"].(string); name == "" {
			t.Fatalf("name is empty for key %s", key)
		}
		if _, ok := h["aliases"].([]interface{}); !ok {
			t.Fatalf("aliases must be an array for key %s", key)
		}
		if _, ok := h["executables"].([]interface{}); !ok {
			t.Fatalf("executables must be an array for key %s", key)
		}
		if _, ok := h["paths"].([]interface{}); !ok {
			t.Fatalf("paths must be an array for key %s", key)
		}
		if _, ok := h["env"].([]interface{}); !ok {
			t.Fatalf("env must be an array for key %s", key)
		}
		sources, _ := h["sources"].([]interface{})
		if len(sources) < 1 {
			t.Fatalf("sources must be non-empty for key %s", key)
		}
		for _, s := range sources {
			sStr, _ := s.(string)
			if len(sStr) < 8 || sStr[:8] != "https://" {
				t.Fatalf("source must be an https URL for key %s: %v", key, s)
			}
		}

		if supportRaw, ok := h["support"]; ok {
			support, _ := mustObject(t, supportRaw, "support")
			for _, area := range supportAreas {
				areaRaw, ok := support[area]
				if !ok {
					t.Fatalf("support.%s is required when support is present for key %s", area, key)
				}
				areaMap, _ := mustObject(t, areaRaw, "support."+area)
				for _, scope := range supportScopes {
					leafRaw, ok := areaMap[scope]
					if !ok {
						t.Fatalf("support.%s.%s is required for key %s", area, scope, key)
					}
					leaf, _ := mustObject(t, leafRaw, "support."+area+"."+scope)
					status, _ := leaf["status"].(string)
					if !supportStatusValues[status] {
						t.Fatalf("unsupported support status %q for key %s area %s scope %s", status, key, area, scope)
					}
					confidence, _ := leaf["confidence"].(string)
					if !supportConfidenceValues[confidence] {
						t.Fatalf("unsupported support confidence %q for key %s area %s scope %s", confidence, key, area, scope)
					}
					supportSources, ok := leaf["sources"].([]interface{})
					if !ok {
						t.Fatalf("support.%s.%s.sources must be an array for key %s", area, scope, key)
					}
					for _, source := range supportSources {
						sourceStr, _ := source.(string)
						if !strings.HasPrefix(sourceStr, "https://") {
							t.Fatalf("support source must be an https URL for key %s area %s scope %s: %v", key, area, scope, source)
						}
					}
					supportPaths, ok := leaf["paths"].([]interface{})
					if !ok {
						t.Fatalf("support.%s.%s.paths must be an array for key %s", area, scope, key)
					}
					for _, supportPath := range supportPaths {
						pathMap, _ := mustObject(t, supportPath, "support path")
						id, _ := pathMap["id"].(string)
						if id == "" {
							t.Fatalf("support path id must be non-empty for key %s area %s scope %s", key, area, scope)
						}
						kind, _ := pathMap["kind"].(string)
						if !kinds[kind] {
							t.Fatalf("support path kind %q invalid for key %s area %s scope %s", kind, key, area, scope)
						}
						tmpl, _ := pathMap["template"].(string)
						if !validateTemplate(tmpl) {
							t.Fatalf("support path template %q invalid for key %s area %s scope %s", tmpl, key, area, scope)
						}
						if platforms, ok := pathMap["platforms"].([]interface{}); ok {
							for _, pl := range platforms {
								plStr, _ := pl.(string)
								if !platformValues[plStr] {
									t.Fatalf("unsupported support path platform %q for key %s area %s scope %s", plStr, key, area, scope)
								}
							}
						}
					}
				}
			}
		}

		paths, _ := h["paths"].([]interface{})
		for _, p := range paths {
			pm, _ := p.(map[string]interface{})
			id, _ := pm["id"].(string)
			if id == "" {
				t.Fatalf("path id must be non-empty for key %s", key)
			}
			category, _ := pm["category"].(string)
			if !categories[category] {
				t.Fatalf("path category %q invalid for key %s", category, key)
			}
			kind, _ := pm["kind"].(string)
			if !kinds[kind] {
				t.Fatalf("path kind %q invalid for key %s", kind, key)
			}
			tmpl, _ := pm["template"].(string)
			if !validateTemplate(tmpl) {
				t.Fatalf("path template %q invalid for key %s", tmpl, key)
			}
			if platforms, ok := pm["platforms"].([]interface{}); ok {
				for _, pl := range platforms {
					plStr, _ := pl.(string)
					if !platformValues[plStr] {
						t.Fatalf("unsupported path platform %q for key %s", plStr, key)
					}
				}
			}
		}

		env, _ := h["env"].([]interface{})
		for _, e := range env {
			em, _ := e.(map[string]interface{})
			name, _ := em["name"].(string)
			if name == "" {
				t.Fatalf("env name must be non-empty for key %s", key)
			}
			desc, _ := em["description"].(string)
			if desc == "" {
				t.Fatalf("env description must be non-empty for key %s", key)
			}
		}

		if roots, ok := h["roots"].([]interface{}); ok {
			for _, r := range roots {
				rm, _ := r.(map[string]interface{})
				name, _ := rm["name"].(string)
				if !rootNameRe.MatchString(name) {
					t.Fatalf("root.name %q must match ^[A-Z][A-Z0-9_]*$ for key %s", name, key)
				}
				if envVal, ok := rm["env"].(string); ok && envVal == "" {
					t.Fatalf("root env must be non-empty for key %s", key)
				}
				if use, ok := rm["use"].(string); ok && !validateTemplate(use) {
					t.Fatalf("root.use %q invalid for key %s", use, key)
				}
				fallback, _ := rm["fallback"].(string)
				if !validateTemplate(fallback) {
					t.Fatalf("root.fallback %q invalid for key %s", fallback, key)
				}
			}
		}

		installations, _ := h["installations"].([]interface{})
		if len(installations) < 1 {
			t.Fatalf("installations must be non-empty for key %s", key)
		}
		for _, installation := range installations {
			im, _ := installation.(map[string]interface{})
			method, _ := im["method"].(string)
			if !slices.Contains(supportedInstallMethods, method) {
				t.Fatalf("unsupported install method %q for key %s", method, key)
			}
			url, _ := im["url"].(string)
			if !strings.HasPrefix(url, "https://") {
				t.Fatalf("installation url must be https for key %s", key)
			}
			if pkg, ok := im["package"].(string); ok && pkg == "" {
				t.Fatalf("installation package must be non-empty for key %s", key)
			}
			if command, ok := im["command"].(string); ok && command == "" {
				t.Fatalf("installation command must be non-empty for key %s", key)
			}
			if notes, ok := im["notes"].(string); ok && notes == "" {
				t.Fatalf("installation notes must be non-empty for key %s", key)
			}
			if platforms, ok := im["platforms"].([]interface{}); ok {
				if len(platforms) < 1 {
					t.Fatalf("installation platforms must be non-empty for key %s", key)
				}
				for _, pl := range platforms {
					plStr, _ := pl.(string)
					if !platformValues[plStr] {
						t.Fatalf("unsupported installation platform %q for key %s", plStr, key)
					}
				}
			}
			if method == "unknown" {
				hasUnknownInstall = true
			}
			if key == "codex" && method == "npm" {
				if pkg, _ := im["package"].(string); pkg == "@openai/codex" {
					codexNpmInstall = true
				}
			}
		}
	}

	if !codexNpmInstall {
		t.Fatal("codex must include npm installation metadata for @openai/codex")
	}
	if !hasUnknownInstall {
		t.Fatal("registry must explicitly represent unknown installation methods")
	}
}

func readJSONFile(t *testing.T, path string) map[string]interface{} {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var value map[string]interface{}
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return value
}

func mustObject(t *testing.T, value interface{}, label string) (map[string]interface{}, bool) {
	t.Helper()
	object, ok := value.(map[string]interface{})
	if !ok {
		t.Fatalf("%s must be an object", label)
	}
	return object, ok
}

func sliceSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func assertNoInstallationMutationMarker(t *testing.T, label string, installations []HarnessInstallation) {
	t.Helper()
	for i, installation := range installations[:cap(installations)] {
		if installation.Method == "MUTATED" || installation.URL == "https://example.com" || installation.Notes == "MUTATED" {
			t.Fatalf("%s installations alias a mutated backing array at position %d", label, i)
		}
		for j, platform := range installation.Platforms[:cap(installation.Platforms)] {
			if platform == "MUTATED" || platform == "plan9" {
				t.Fatalf("%s installation platforms alias a mutated backing array at position %d/%d", label, i, j)
			}
		}
	}
}
