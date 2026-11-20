package harnessdetect

import (
	"reflect"
	"strings"
	"testing"
)

func TestHarnessMCPMetadata(t *testing.T) {
	record, err := GetHarnessMCP(" Claude ")
	if err != nil {
		t.Fatal(err)
	}
	if record.Key != "claude-code" || record.MCP.MCPJSON != "supported" {
		t.Fatalf("GetHarnessMCP = %+v", record)
	}
	record.MCP.Global.KeyPath[0] = "MUTATED"
	again, _ := GetHarnessMCP("claude-code")
	if again.MCP.Global.KeyPath[0] != "mcpServers" {
		t.Fatal("GetHarnessMCP returned shared key path storage")
	}
	if len(ListHarnessMCP()) != len(ListHarnesses()) {
		t.Fatal("ListHarnessMCP must cover every harness")
	}
	if _, err := GetHarnessMCP("not-a-harness"); err == nil || err.Error() != "Unknown harness: not-a-harness" {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestTranslateMCPJSON(t *testing.T) {
	document := []byte(`{"mcpServers":{"fs":{"command":"npx","args":["-y","fs"]},"legacy":{"type":"sse","url":"https://example.com/sse"}}}`)
	translation, err := TranslateMCPJSON("codex", document, MCPTranslateOptions{Scope: "global"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"mcp_servers": map[string]any{"fs": map[string]any{"command": "npx", "args": []any{"-y", "fs"}}}}
	if translation.Format != "toml" || !reflect.DeepEqual(translation.Config, want) {
		t.Fatalf("translation = %+v", translation)
	}
	if !reflect.DeepEqual(translation.Skipped, []MCPSkippedServer{{Name: "legacy", Reason: "unsupported transport: sse"}}) {
		t.Fatalf("skipped = %+v", translation.Skipped)
	}

	for _, tc := range []struct {
		input, scope, document, want string
	}{
		{"aider", "", `{"mcpServers":{}}`, "has no file-based MCP config for scope local"},
		{"codex", "", `{"servers":{}}`, "must be an object with an mcpServers object"},
		{"codex", "project", `{"mcpServers":{}}`, "Unknown MCP scope: project"},
	} {
		_, err := TranslateMCPJSON(tc.input, []byte(tc.document), MCPTranslateOptions{Scope: tc.scope})
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("TranslateMCPJSON(%q, %q) error = %v, want %q", tc.input, tc.scope, err, tc.want)
		}
	}
}
