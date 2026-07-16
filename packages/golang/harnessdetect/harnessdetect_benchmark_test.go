package harnessdetect

import (
	"os"
	"path/filepath"
	"testing"
)

func benchmarkCheckOptions(b *testing.B) CheckOptions {
	b.Helper()

	root := b.TempDir()
	home := filepath.Join(root, "home")
	cwd := filepath.Join(root, "cwd")

	for _, dir := range []string{
		home,
		cwd,
		filepath.Join(home, ".config"),
		filepath.Join(home, ".local", "share"),
		filepath.Join(home, ".local", "state"),
		filepath.Join(home, ".cache"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	return CheckOptions{
		CWD: cwd,
		Env: map[string]string{
			"HOME":                 home,
			"PATH":                 "",
			"XDG_CONFIG_HOME":      filepath.Join(home, ".config"),
			"XDG_DATA_HOME":        filepath.Join(home, ".local", "share"),
			"XDG_STATE_HOME":       filepath.Join(home, ".local", "state"),
			"XDG_CACHE_HOME":       filepath.Join(home, ".cache"),
			"CODEX_HOME":           filepath.Join(root, "overrides", "codex"),
			"CLAUDE_CONFIG_DIR":    filepath.Join(root, "overrides", "claude"),
			"GEMINI_CLI_HOME":      filepath.Join(root, "overrides", "gemini-home"),
			"OPENCODE_CONFIG_DIR":  filepath.Join(root, "overrides", "opencode-config"),
			"GOOSE_PATH_ROOT":      filepath.Join(root, "overrides", "goose"),
			"CLINE_DIR":            filepath.Join(root, "overrides", "cline"),
			"Q_CLI_DATA_DIR":       filepath.Join(root, "overrides", "amazon-q"),
			"COPILOT_HOME":         filepath.Join(root, "overrides", "copilot"),
			"COPILOT_CACHE_HOME":   filepath.Join(root, "overrides", "copilot-cache"),
			"AMP_DATA_HOME":        filepath.Join(root, "overrides", "amp-data"),
			"HERMES_HOME":          filepath.Join(root, "overrides", "hermes"),
			"OPENCLAW_HOME":        filepath.Join(root, "overrides", "openclaw"),
			"OPENCLAW_STATE_DIR":   filepath.Join(root, "overrides", "openclaw-state"),
			"AUTOGENSTUDIO_APPDIR": filepath.Join(root, "overrides", "autogenstudio"),
		},
	}
}

func BenchmarkDetectHarnesses(b *testing.B) {
	options := benchmarkCheckOptions(b)
	harnessCount := len(ListHarnesses())

	results, err := DetectHarnesses(options)
	if err != nil {
		b.Fatalf("warmup detect: %v", err)
	}
	if len(results) != harnessCount {
		b.Fatalf("warmup detect count = %d, want %d", len(results), harnessCount)
	}

	b.ReportAllocs()
	b.ReportMetric(float64(harnessCount), "harnesses/op")
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		results, err := DetectHarnesses(options)
		if err != nil {
			b.Fatalf("detect: %v", err)
		}
		if len(results) != harnessCount {
			b.Fatalf("detect count = %d, want %d", len(results), harnessCount)
		}
	}
}
