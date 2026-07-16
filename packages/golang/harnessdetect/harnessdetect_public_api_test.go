package harnessdetect_test

import (
	"reflect"
	"testing"

	harnessdetect "github.com/auron/harness-detect/packages/golang/harnessdetect"
)

var (
	_ func() harnessdetect.HarnessMatrix                                                 = harnessdetect.GetRawHarnessData
	_ func() harnessdetect.HarnessMatrix                                                 = harnessdetect.GetHarnessMatrix
	_ func() []harnessdetect.HarnessDefinition                                           = harnessdetect.ListHarnesses
	_ func(string) (harnessdetect.HarnessSupportRecord, error)                           = harnessdetect.GetHarnessSupport
	_ func() []harnessdetect.HarnessSupportRecord                                        = harnessdetect.ListHarnessSupport
	_ func(string, harnessdetect.CheckOptions) (harnessdetect.HarnessCheckResult, error) = harnessdetect.CheckHarness
	_ func(harnessdetect.CheckOptions) ([]harnessdetect.HarnessCheckResult, error)       = harnessdetect.DetectHarnesses
	_ func(harnessdetect.CheckOptions) ([]harnessdetect.HarnessCheckResult, error)       = harnessdetect.DetectInstalledHarnesses

	_ = harnessdetect.HarnessEnvVar{Name: "NAME", Description: "desc"}
	_ = harnessdetect.HarnessPathSpec{ID: "id", Category: "config", Kind: "file", Template: "${HOME}/file", Platforms: []string{"darwin"}}
	_ = harnessdetect.HarnessSupportPath{ID: "id", Kind: "file", Template: "${HOME}/file", Platforms: []string{"darwin"}, Description: "desc"}
	_ = harnessdetect.HarnessSupportScope{Status: "supported", Paths: []harnessdetect.HarnessSupportPath{{ID: "id", Kind: "file", Template: "${HOME}/file"}}, Sources: []string{"https://example.com"}, Confidence: "official", Notes: "note"}
	_ = harnessdetect.HarnessSupportArea{Global: harnessdetect.HarnessSupportScope{Status: "supported"}, Local: harnessdetect.HarnessSupportScope{Status: "unsupported"}}
	_ = harnessdetect.HarnessSupport{Config: harnessdetect.HarnessSupportArea{}, Skills: harnessdetect.HarnessSupportArea{}, Commands: harnessdetect.HarnessSupportArea{}, Agents: harnessdetect.HarnessSupportArea{}, DotAgents: harnessdetect.HarnessSupportArea{}}
	_ = harnessdetect.HarnessRootDef{Name: "ROOT", Env: "ROOT_ENV", Use: "${ROOT_ENV}", Fallback: "${HOME}/root"}
	_ = harnessdetect.HarnessDefinition{
		Key:         "codex",
		Name:        "Codex",
		Aliases:     []string{"alias"},
		Executables: []string{"codex"},
		Paths:       []harnessdetect.HarnessPathSpec{{ID: "config", Category: "config", Kind: "file", Template: "${HOME}/config.toml"}},
		Roots:       []harnessdetect.HarnessRootDef{{Name: "CODEX_ROOT", Fallback: "${HOME}/.codex"}},
		Support:     harnessdetect.HarnessSupport{},
		Env:         []harnessdetect.HarnessEnvVar{{Name: "CODEX_HOME", Description: "override"}},
		Sources:     []string{"https://example.com"},
	}
	_ = harnessdetect.HarnessMatrix{Version: 1, Harnesses: []harnessdetect.HarnessDefinition{{Key: "codex"}}}
	_ = harnessdetect.HarnessSupportRecord{Key: "codex", Name: "Codex", Support: harnessdetect.HarnessSupport{}}
	_ = harnessdetect.ResolvedHarnessPath{
		HarnessPathSpec: harnessdetect.HarnessPathSpec{ID: "config", Category: "config", Kind: "file", Template: "${HOME}/config.toml"},
		Path:            stringPtr("/tmp/config.toml"),
		Exists:          true,
	}
	_ = harnessdetect.CheckOptions{Env: map[string]string{"HOME": "/tmp"}, CWD: "/repo"}
	_ = harnessdetect.HarnessCheckResult{
		Key:            "codex",
		Name:           "Codex",
		Installed:      true,
		ExecutablePath: stringPtr("/tmp/codex"),
		Harness:        harnessdetect.HarnessDefinition{Key: "codex"},
		Paths:          []harnessdetect.ResolvedHarnessPath{{}},
		MatchedPaths:   []harnessdetect.ResolvedHarnessPath{{}},
		Reasons:        []string{"executable:codex"},
	}
)

func stringPtr(v string) *string { return &v }

func TestPublicAPIResultStructShape(t *testing.T) {
	t.Parallel()

	assertStructFields(t, reflect.TypeOf(harnessdetect.ResolvedHarnessPath{}), map[string]reflect.Type{
		"HarnessPathSpec": reflect.TypeOf(harnessdetect.HarnessPathSpec{}),
		"Path":            reflect.TypeOf((*string)(nil)),
		"Exists":          reflect.TypeOf(true),
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.ResolvedHarnessPath{}), map[string]string{
		"Path":   "path",
		"Exists": "exists",
	})

	assertStructFields(t, reflect.TypeOf(harnessdetect.HarnessCheckResult{}), map[string]reflect.Type{
		"Key":            reflect.TypeOf(""),
		"Name":           reflect.TypeOf(""),
		"Installed":      reflect.TypeOf(true),
		"ExecutablePath": reflect.TypeOf((*string)(nil)),
		"Harness":        reflect.TypeOf(harnessdetect.HarnessDefinition{}),
		"Paths":          reflect.TypeOf([]harnessdetect.ResolvedHarnessPath(nil)),
		"MatchedPaths":   reflect.TypeOf([]harnessdetect.ResolvedHarnessPath(nil)),
		"Reasons":        reflect.TypeOf([]string(nil)),
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessCheckResult{}), map[string]string{
		"Key":            "key",
		"Name":           "name",
		"Installed":      "installed",
		"ExecutablePath": "executablePath",
		"Harness":        "harness",
		"Paths":          "paths",
		"MatchedPaths":   "matchedPaths",
		"Reasons":        "reasons",
	})
}

func TestPublicAPIExportedStructJSONTags(t *testing.T) {
	t.Parallel()

	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessEnvVar{}), map[string]string{
		"Name":        "name",
		"Description": "description",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessPathSpec{}), map[string]string{
		"ID":        "id",
		"Category":  "category",
		"Kind":      "kind",
		"Template":  "template",
		"Platforms": "platforms,omitempty",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessRootDef{}), map[string]string{
		"Name":     "name",
		"Env":      "env,omitempty",
		"Use":      "use,omitempty",
		"Fallback": "fallback",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessSupportPath{}), map[string]string{
		"ID":          "id",
		"Kind":        "kind",
		"Template":    "template",
		"Platforms":   "platforms,omitempty",
		"Description": "description,omitempty",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessSupportScope{}), map[string]string{
		"Status":     "status",
		"Paths":      "paths",
		"Sources":    "sources",
		"Confidence": "confidence",
		"Notes":      "notes,omitempty",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessSupportArea{}), map[string]string{
		"Global": "global",
		"Local":  "local",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessSupport{}), map[string]string{
		"Config":    "config",
		"Skills":    "skills",
		"Commands":  "commands",
		"Agents":    "agents",
		"DotAgents": "dotAgents",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessDefinition{}), map[string]string{
		"Key":           "key",
		"Name":          "name",
		"Aliases":       "aliases",
		"Executables":   "executables",
		"Paths":         "paths",
		"Roots":         "roots,omitempty",
		"Support":       "support",
		"Env":           "env",
		"Sources":       "sources",
		"Installations": "installations",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessMatrix{}), map[string]string{
		"Version":   "version",
		"Harnesses": "harnesses",
	})
	assertJSONTags(t, reflect.TypeOf(harnessdetect.HarnessSupportRecord{}), map[string]string{
		"Key":     "key",
		"Name":    "name",
		"Support": "support",
	})
}

func assertStructFields(t *testing.T, typ reflect.Type, want map[string]reflect.Type) {
	t.Helper()

	if typ.NumField() != len(want) {
		t.Fatalf("%s field count = %d, want %d", typ.Name(), typ.NumField(), len(want))
	}

	for fieldName, wantType := range want {
		field, ok := typ.FieldByName(fieldName)
		if !ok {
			t.Fatalf("%s missing field %q", typ.Name(), fieldName)
		}
		if field.Type != wantType {
			t.Fatalf("%s.%s type = %s, want %s", typ.Name(), fieldName, field.Type, wantType)
		}
	}
}

func assertJSONTags(t *testing.T, typ reflect.Type, want map[string]string) {
	t.Helper()

	for fieldName, wantTag := range want {
		field, ok := typ.FieldByName(fieldName)
		if !ok {
			t.Fatalf("%s missing field %q", typ.Name(), fieldName)
		}
		if got := field.Tag.Get("json"); got != wantTag {
			t.Fatalf("%s.%s json tag = %q, want %q", typ.Name(), fieldName, got, wantTag)
		}
	}
}
