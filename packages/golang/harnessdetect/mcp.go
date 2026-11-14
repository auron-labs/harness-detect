package harnessdetect

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"sort"
)

// HarnessMCPScope describes where a harness stores MCP servers for one scope.
type HarnessMCPScope struct {
	Status string `json:"status"`
	// Paths lists config files (or directories of config files) holding MCP
	// servers for this scope.
	Paths []HarnessSupportPath `json:"paths"`
	// Format is json, jsonc, toml, or yaml. Set when Status is supported and
	// Paths is non-empty.
	Format string `json:"format,omitempty"`
	// KeyPath lists the key segments under which servers are stored,
	// outermost first.
	KeyPath    []string `json:"keyPath,omitempty"`
	Sources    []string `json:"sources"`
	Confidence string   `json:"confidence"`
	Notes      string   `json:"notes,omitempty"`
}

// HarnessMCPStdioFormat names the native fields of a stdio server entry.
type HarnessMCPStdioFormat struct {
	Type    string `json:"type,omitempty"`
	Command string `json:"command"`
	// Args is empty when the command field holds an argv array
	// [command, ...args].
	Args string `json:"args,omitempty"`
	// Env is empty when the harness cannot set server environment variables.
	Env string `json:"env,omitempty"`
}

// HarnessMCPRemoteFormat names the native fields of a remote server entry.
type HarnessMCPRemoteFormat struct {
	Type string `json:"type,omitempty"`
	URL  string `json:"url"`
	// Headers is empty when the harness cannot set HTTP headers.
	Headers string `json:"headers,omitempty"`
}

// HarnessMCPServerFormat describes one native MCP server entry so .mcp.json
// servers can be translated without harness-specific code.
type HarnessMCPServerFormat struct {
	// Container is "map" (object keyed by name) or "array".
	Container string                  `json:"container"`
	NameField string                  `json:"nameField,omitempty"`
	TypeField string                  `json:"typeField,omitempty"`
	Stdio     HarnessMCPStdioFormat   `json:"stdio"`
	HTTP      *HarnessMCPRemoteFormat `json:"http,omitempty"`
	SSE       *HarnessMCPRemoteFormat `json:"sse,omitempty"`
	Defaults  map[string]any          `json:"defaults,omitempty"`
}

// HarnessMCP is the MCP client metadata for a harness.
type HarnessMCP struct {
	// Status reports whether the harness can use MCP servers.
	Status string `json:"status"`
	// MCPJSON reports whether the harness natively reads the project-root
	// .mcp.json file.
	MCPJSON      string                  `json:"mcpJson"`
	Global       HarnessMCPScope         `json:"global"`
	Local        HarnessMCPScope         `json:"local"`
	ServerFormat *HarnessMCPServerFormat `json:"serverFormat,omitempty"`
	Sources      []string                `json:"sources"`
	Confidence   string                  `json:"confidence"`
	Notes        string                  `json:"notes,omitempty"`
}

// HarnessMCPRecord exposes MCP metadata for one harness.
type HarnessMCPRecord struct {
	Key  string     `json:"key"`
	Name string     `json:"name"`
	MCP  HarnessMCP `json:"mcp"`
}

// MCPTranslateOptions configures TranslateMCPJSON.
type MCPTranslateOptions struct {
	// Scope is "global" or "local". Empty means "local".
	Scope string
}

// MCPSkippedServer is a .mcp.json server the native format cannot represent.
type MCPSkippedServer struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// MCPTranslation is a .mcp.json document translated into a harness's native
// MCP config for one scope.
type MCPTranslation struct {
	Key     string   `json:"key"`
	Name    string   `json:"name"`
	Scope   string   `json:"scope"`
	Format  string   `json:"format"`
	KeyPath []string `json:"keyPath"`
	// Servers is a map[string]any keyed by server name, or a []any for
	// array containers.
	Servers any `json:"servers"`
	// Config nests Servers under KeyPath, ready to merge into the native
	// config file.
	Config  map[string]any     `json:"config"`
	Skipped []MCPSkippedServer `json:"skipped"`
}

// GetHarnessMCP returns MCP metadata for one harness by key or alias.
func GetHarnessMCP(input string) (HarnessMCPRecord, error) {
	h, ok := getHarnessDefinition(input)
	if !ok {
		return HarnessMCPRecord{}, errors.New("Unknown harness: " + input)
	}
	return HarnessMCPRecord{Key: h.Key, Name: h.Name, MCP: cloneMCP(h.MCP)}, nil
}

// ListHarnessMCP returns MCP metadata for all harnesses.
func ListHarnessMCP() []HarnessMCPRecord {
	loadMatrix()
	out := make([]HarnessMCPRecord, len(matrix.Harnesses))
	for i, h := range matrix.Harnesses {
		out[i] = HarnessMCPRecord{Key: h.Key, Name: h.Name, MCP: cloneMCP(h.MCP)}
	}
	return out
}

// TranslateMCPJSON translates a project .mcp.json document
// ({"mcpServers": {...}}) into the native MCP config of a harness for one
// scope. It is pure: nothing is read or written. Servers the native format
// cannot represent are listed in Skipped.
func TranslateMCPJSON(input string, mcpJSON []byte, options MCPTranslateOptions) (MCPTranslation, error) {
	harness, ok := getHarnessDefinition(input)
	if !ok {
		return MCPTranslation{}, errors.New("Unknown harness: " + input)
	}

	scope := options.Scope
	if scope == "" {
		scope = "local"
	}
	var leaf HarnessMCPScope
	switch scope {
	case "global":
		leaf = harness.MCP.Global
	case "local":
		leaf = harness.MCP.Local
	default:
		return MCPTranslation{}, errors.New("Unknown MCP scope: " + scope)
	}

	format := harness.MCP.ServerFormat
	if harness.MCP.Status != "supported" || leaf.Status != "supported" || leaf.Format == "" || format == nil {
		return MCPTranslation{}, errors.New("Harness " + harness.Key + " has no file-based MCP config for scope " + scope)
	}

	var document any
	if err := json.Unmarshal(mcpJSON, &document); err != nil {
		return MCPTranslation{}, fmt.Errorf("parse .mcp.json: %w", err)
	}
	documentObject, isObject := document.(map[string]any)
	if !isObject {
		return MCPTranslation{}, errors.New(".mcp.json must be an object with an mcpServers object")
	}
	servers, isObject := documentObject["mcpServers"].(map[string]any)
	if !isObject {
		return MCPTranslation{}, errors.New(".mcp.json must be an object with an mcpServers object")
	}

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sort.Strings(names)

	mapped := map[string]any{}
	entries := []any{}
	skipped := []MCPSkippedServer{}
	for _, name := range names {
		entry, reason := translateMCPServer(name, servers[name], format)
		switch {
		case reason != "":
			skipped = append(skipped, MCPSkippedServer{Name: name, Reason: reason})
		case format.Container == "array":
			entries = append(entries, entry)
		default:
			mapped[name] = entry
		}
	}

	var native any = mapped
	if format.Container == "array" {
		native = entries
	}

	config := native
	for i := len(leaf.KeyPath) - 1; i >= 0; i-- {
		config = map[string]any{leaf.KeyPath[i]: config}
	}

	return MCPTranslation{
		Key:     harness.Key,
		Name:    harness.Name,
		Scope:   scope,
		Format:  leaf.Format,
		KeyPath: slices.Clone(leaf.KeyPath),
		Servers: native,
		Config:  config.(map[string]any),
		Skipped: skipped,
	}, nil
}

// translateMCPServer returns a native entry, or a non-empty reason when the
// server cannot be translated. Check order matches every package.
func translateMCPServer(name string, raw any, format *HarnessMCPServerFormat) (map[string]any, string) {
	server, isObject := raw.(map[string]any)
	if !isObject {
		return nil, "invalid server entry"
	}

	var transport string
	if rawType, hasType := server["type"]; hasType {
		typeName, isString := rawType.(string)
		if !isString {
			return nil, "invalid server entry"
		}
		if typeName != "stdio" && typeName != "http" && typeName != "sse" {
			return nil, "unsupported transport: " + typeName
		}
		transport = typeName
	} else if _, hasCommand := server["command"]; hasCommand {
		transport = "stdio"
	} else if _, hasURL := server["url"]; hasURL {
		transport = "http"
	} else {
		return nil, "missing command or url"
	}

	var remote *HarnessMCPRemoteFormat
	switch transport {
	case "http":
		remote = format.HTTP
	case "sse":
		remote = format.SSE
	}
	if transport != "stdio" && remote == nil {
		return nil, "unsupported transport: " + transport
	}

	entry := maps.Clone(format.Defaults)
	if entry == nil {
		entry = map[string]any{}
	}
	if format.NameField != "" {
		entry[format.NameField] = name
	}

	if transport == "stdio" {
		target := format.Stdio
		if target.Type != "" {
			entry[format.TypeField] = target.Type
		}
		command, isString := server["command"].(string)
		if !isString || command == "" {
			return nil, "missing command"
		}
		args, valid := optionalStrings(server["args"])
		if !valid {
			return nil, "invalid args"
		}
		env, valid := optionalStringMap(server["env"])
		if !valid {
			return nil, "invalid env"
		}
		if target.Args != "" {
			entry[target.Command] = command
			entry[target.Args] = args
		} else {
			entry[target.Command] = append([]any{command}, args...)
		}
		if len(env) > 0 {
			if target.Env == "" {
				return nil, "env not supported"
			}
			entry[target.Env] = env
		}
		return entry, ""
	}

	if remote.Type != "" {
		entry[format.TypeField] = remote.Type
	}
	url, isString := server["url"].(string)
	if !isString || url == "" {
		return nil, "missing url"
	}
	headers, valid := optionalStringMap(server["headers"])
	if !valid {
		return nil, "invalid headers"
	}
	entry[remote.URL] = url
	if len(headers) > 0 {
		if remote.Headers == "" {
			return nil, "headers not supported"
		}
		entry[remote.Headers] = headers
	}
	return entry, ""
}

// optionalStrings accepts a missing value or an array of strings.
func optionalStrings(value any) ([]any, bool) {
	if value == nil {
		return []any{}, true
	}
	items, isArray := value.([]any)
	if !isArray {
		return nil, false
	}
	for _, item := range items {
		if _, isString := item.(string); !isString {
			return nil, false
		}
	}
	return slices.Clone(items), true
}

// optionalStringMap accepts a missing value or an object of strings.
func optionalStringMap(value any) (map[string]any, bool) {
	if value == nil {
		return map[string]any{}, true
	}
	object, isObject := value.(map[string]any)
	if !isObject {
		return nil, false
	}
	for _, item := range object {
		if _, isString := item.(string); !isString {
			return nil, false
		}
	}
	return maps.Clone(object), true
}

func cloneMCPScope(scope HarnessMCPScope) HarnessMCPScope {
	out := scope
	out.Paths = cloneSupportPaths(scope.Paths)
	out.KeyPath = slices.Clone(scope.KeyPath)
	out.Sources = slices.Clone(scope.Sources)
	return out
}

func cloneMCP(mcp HarnessMCP) HarnessMCP {
	out := mcp
	out.Global = cloneMCPScope(mcp.Global)
	out.Local = cloneMCPScope(mcp.Local)
	out.Sources = slices.Clone(mcp.Sources)
	if mcp.ServerFormat != nil {
		format := *mcp.ServerFormat
		format.Defaults = maps.Clone(mcp.ServerFormat.Defaults)
		if format.HTTP != nil {
			http := *format.HTTP
			format.HTTP = &http
		}
		if format.SSE != nil {
			sse := *format.SSE
			format.SSE = &sse
		}
		out.ServerFormat = &format
	}
	return out
}
