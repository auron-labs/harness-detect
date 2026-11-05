package harnessdetect

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestACPMissing(t *testing.T) {
	raw := GetRawHarnessData()
	for _, h := range raw.Harnesses {
		got, err := GetHarnessACP(h.Key)
		if err != nil || !reflect.DeepEqual(got, cloneHarnessACPRecord(h)) {
			t.Fatalf("getter mismatch: %#v, %v", got, err)
		}
		data, err := json.Marshal(h)
		if err != nil {
			t.Fatal(err)
		}
		if h.ACP == nil && strings.Contains(string(data), `"acp"`) {
			t.Fatal("omission lost")
		}
	}
	got, err := GetHarnessACP(" OPENAI/CODEX ")
	if err != nil || got.Key != "codex" {
		t.Fatalf("alias: %#v, %v", got, err)
	}
	if _, err := GetHarnessACP("absent"); err == nil || err.Error() != "Unknown harness: absent" {
		t.Fatalf("unknown error: %v", err)
	}
}

func TestACPSyntheticPublicFlows(t *testing.T) {
	loadMatrix()
	original := matrix
	t.Cleanup(func() { matrix = original })
	data, err := os.ReadFile("../../../testdata/acp-registry.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture HarnessMatrix
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	matrix = fixture
	expected := cloneMatrix(matrix)
	got, err := GetHarnessACP(" NATIVE-ALIAS ")
	if err != nil || got.Key != "native" {
		t.Fatalf("alias: %#v %v", got, err)
	}
	if !reflect.DeepEqual(got.ACP.Launch.Args, []string{"--acp", "two words", ""}) {
		t.Fatalf("argv changed: %#v", got.ACP.Launch.Args)
	}
	host, err := GetHarnessACP("host")
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := GetHarnessACP(host.ACP.Adapter)
	if err != nil || bridge.ACP.Launch.Command != "example-bridge" {
		t.Fatalf("adapter: %#v %v", bridge, err)
	}
	empty, err := json.Marshal(bridge.ACP.Launch)
	if err != nil || !strings.Contains(string(empty), `"args":[]`) {
		t.Fatalf("empty argv lost: %s, %v", empty, err)
	}
	for _, key := range []string{"unknown", "missing"} {
		record, err := GetHarnessACP(key)
		if err != nil || record.ACP.Status != "unknown" {
			t.Fatalf("unknown: %#v %v", record, err)
		}
	}
	unsupported, _ := GetHarnessACP("unsupported")
	if unsupported.ACP.Status != "unsupported" {
		t.Fatal("unsupported lost")
	}
	records := ListHarnessACP()
	if len(records) != len(expected.Harnesses) {
		t.Fatal("list length")
	}
	records[0].ACP.Launch.Args[0] = "mutated"
	records[0].ACP.Launch.Platforms[0] = "win32"
	records[0].ACP.Sources[0] = "https://example.com/mutated"
	got.ACP.Launch.Command = "mutated"
	for _, h := range ListHarnesses() {
		result, err := CheckHarness(h.Key, CheckOptions{Env: map[string]string{"HOME": t.TempDir(), "PATH": ""}})
		if err != nil || result.Installed {
			t.Fatalf("ACP is not detection evidence: %#v, %v", result, err)
		}
		if !reflect.DeepEqual(result.Harness, h) {
			t.Fatal("detection lost metadata")
		}
		if h.ACP != nil && h.ACP.Launch != nil {
			h.ACP.Launch.Args = append(h.ACP.Launch.Args, "mutated")
		}
		if result.Harness.ACP != nil && result.Harness.ACP.Launch != nil {
			result.Harness.ACP.Launch.Command = "mutated"
		}
		encoded, err := json.Marshal(result.Harness)
		if err != nil {
			t.Fatal(err)
		}
		if h.Key == "missing" && strings.Contains(string(encoded), `"acp"`) {
			t.Fatal("missing ACP serialized")
		}
	}
	raw := GetRawHarnessData()
	raw.Harnesses[0].ACP.Launch.Command = "mutated"
	if !reflect.DeepEqual(GetRawHarnessData(), expected) {
		t.Fatal("ACP snapshot mutation reached registry")
	}
	support, _ := GetHarnessSupport("native")
	encoded, err := json.Marshal(support)
	if err != nil || strings.Contains(string(encoded), `"acp"`) {
		t.Fatal("support getter gained ACP")
	}
}
