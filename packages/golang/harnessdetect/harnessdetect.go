// Package harnessdetect detects installed LLM harnesses and resolves their
// config/state paths from an embedded JSON registry. It is a Go port of the
// @auron-labs/harness-detect TypeScript package.
package harnessdetect

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

func processEnvMap() map[string]string {
	entries := os.Environ()
	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			out[entry] = ""
			continue
		}
		out[key] = value
	}
	return out
}

//go:embed data/harnesses.json
var matrixJSON []byte

var (
	matrix     HarnessMatrix
	matrixOnce sync.Once
)

func loadMatrix() {
	matrixOnce.Do(func() {
		var loaded HarnessMatrix
		if err := json.Unmarshal(matrixJSON, &loaded); err != nil {
			panic(fmt.Sprintf("harnessdetect: failed to parse embedded matrix: %v", err))
		}
		matrix = loaded
	})
}

// HarnessEnvVar documents a harness-relevant environment variable.
type HarnessEnvVar struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// HarnessPathSpec is one path template to check for a harness.
type HarnessPathSpec struct {
	ID        string   `json:"id"`
	Category  string   `json:"category"`
	Kind      string   `json:"kind"`
	Template  string   `json:"template"`
	Platforms []string `json:"platforms,omitempty"`
}

// HarnessSupportPath describes one support-related path template.
type HarnessSupportPath struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Template    string   `json:"template"`
	Platforms   []string `json:"platforms,omitempty"`
	Description string   `json:"description,omitempty"`
}

// HarnessSupportScope describes one support capability for one scope.
type HarnessSupportScope struct {
	Status     string               `json:"status"`
	Paths      []HarnessSupportPath `json:"paths"`
	Sources    []string             `json:"sources"`
	Confidence string               `json:"confidence"`
	Notes      string               `json:"notes,omitempty"`
}

// HarnessSupportArea describes one support capability area.
type HarnessSupportArea struct {
	Global HarnessSupportScope `json:"global"`
	Local  HarnessSupportScope `json:"local"`
}

// HarnessSupport describes support metadata for a harness.
type HarnessSupport struct {
	Config    HarnessSupportArea `json:"config"`
	Skills    HarnessSupportArea `json:"skills"`
	Commands  HarnessSupportArea `json:"commands"`
	Agents    HarnessSupportArea `json:"agents"`
	DotAgents HarnessSupportArea `json:"dotAgents"`
}

// HarnessRootDef declares a derived template variable for a harness.
type HarnessRootDef struct {
	Name     string `json:"name"`
	Env      string `json:"env,omitempty"`
	Use      string `json:"use,omitempty"`
	Fallback string `json:"fallback"`
}

// HarnessInstallation describes one documented installation method.
type HarnessInstallation struct {
	Method      string   `json:"method"`
	Package     string   `json:"package,omitempty"`
	Command     string   `json:"command,omitempty"`
	URL         string   `json:"url,omitempty"`
	Marketplace string   `json:"marketplace,omitempty"`
	ID          string   `json:"id,omitempty"`
	Platforms   []string `json:"platforms,omitempty"`
	Notes       string   `json:"notes,omitempty"`
}

// HarnessDefinition describes a single LLM harness.
type HarnessDefinition struct {
	Key           string                `json:"key"`
	Name          string                `json:"name"`
	Aliases       []string              `json:"aliases"`
	Executables   []string              `json:"executables"`
	Paths         []HarnessPathSpec     `json:"paths"`
	Roots         []HarnessRootDef      `json:"roots,omitempty"`
	Support       HarnessSupport        `json:"support"`
	Env           []HarnessEnvVar       `json:"env"`
	Sources       []string              `json:"sources"`
	Installations []HarnessInstallation `json:"installations"`
}

// HarnessSupportRecord exposes one harness support entry.
type HarnessSupportRecord struct {
	Key     string         `json:"key"`
	Name    string         `json:"name"`
	Support HarnessSupport `json:"support"`
}

// HarnessMatrix is the top-level registry document.
type HarnessMatrix struct {
	Version   int                 `json:"version"`
	Harnesses []HarnessDefinition `json:"harnesses"`
}

// ResolvedHarnessPath extends HarnessPathSpec with a resolved path and
// existence check.
type ResolvedHarnessPath struct {
	HarnessPathSpec
	Path   *string `json:"path"`
	Exists bool    `json:"exists"`
}

// CheckOptions configures harness detection.
type CheckOptions struct {
	Env map[string]string
	CWD string
}

// HarnessCheckResult is the result of checking a single harness.
type HarnessCheckResult struct {
	Key            string                `json:"key"`
	Name           string                `json:"name"`
	Installed      bool                  `json:"installed"`
	ExecutablePath *string               `json:"executablePath"`
	Harness        HarnessDefinition     `json:"harness"`
	Paths          []ResolvedHarnessPath `json:"paths"`
	MatchedPaths   []ResolvedHarnessPath `json:"matchedPaths"`
	Reasons        []string              `json:"reasons"`
}

// GetRawHarnessData returns a defensive copy of the loaded harness registry.
func GetRawHarnessData() HarnessMatrix {
	loadMatrix()
	return cloneMatrix(matrix)
}

// GetHarnessMatrix returns a copy of the loaded harness matrix.
//
// Deprecated: use GetRawHarnessData instead. This remains as a compatibility
// wrapper for existing callers.
func GetHarnessMatrix() HarnessMatrix {
	return GetRawHarnessData()
}

// ListHarnesses returns a copy of the list of harness definitions.
func ListHarnesses() []HarnessDefinition {
	loadMatrix()
	return cloneHarnesses(matrix.Harnesses)
}

// GetHarnessSupport returns support metadata for one harness by key or alias.
func GetHarnessSupport(input string) (HarnessSupportRecord, error) {
	harness, ok := getHarnessDefinition(input)
	if !ok {
		return HarnessSupportRecord{}, errors.New("Unknown harness: " + input)
	}
	return cloneHarnessSupportRecord(harness), nil
}

// ListHarnessSupport returns support metadata for all harnesses.
func ListHarnessSupport() []HarnessSupportRecord {
	loadMatrix()
	out := make([]HarnessSupportRecord, len(matrix.Harnesses))
	for i, harness := range matrix.Harnesses {
		out[i] = cloneHarnessSupportRecord(harness)
	}
	return out
}

func cloneMatrix(m HarnessMatrix) HarnessMatrix {
	return HarnessMatrix{
		Version:   m.Version,
		Harnesses: cloneHarnesses(m.Harnesses),
	}
}

func cloneHarnesses(harnesses []HarnessDefinition) []HarnessDefinition {
	out := make([]HarnessDefinition, len(harnesses))
	for i, h := range harnesses {
		out[i] = cloneHarnessDefinition(h)
	}
	return out
}

func cloneSupportPaths(paths []HarnessSupportPath) []HarnessSupportPath {
	out := make([]HarnessSupportPath, len(paths))
	for i, path := range paths {
		out[i] = HarnessSupportPath{
			ID:          path.ID,
			Kind:        path.Kind,
			Template:    path.Template,
			Platforms:   append([]string(nil), path.Platforms...),
			Description: path.Description,
		}
	}
	return out
}

func cloneSupportScope(scope HarnessSupportScope) HarnessSupportScope {
	return HarnessSupportScope{
		Status:     scope.Status,
		Paths:      cloneSupportPaths(scope.Paths),
		Sources:    append([]string(nil), scope.Sources...),
		Confidence: scope.Confidence,
		Notes:      scope.Notes,
	}
}

func cloneSupportArea(area HarnessSupportArea) HarnessSupportArea {
	return HarnessSupportArea{
		Global: cloneSupportScope(area.Global),
		Local:  cloneSupportScope(area.Local),
	}
}

func cloneSupport(support HarnessSupport) HarnessSupport {
	return HarnessSupport{
		Config:    cloneSupportArea(support.Config),
		Skills:    cloneSupportArea(support.Skills),
		Commands:  cloneSupportArea(support.Commands),
		Agents:    cloneSupportArea(support.Agents),
		DotAgents: cloneSupportArea(support.DotAgents),
	}
}

func cloneHarnessSupportRecord(h HarnessDefinition) HarnessSupportRecord {
	return HarnessSupportRecord{
		Key:     h.Key,
		Name:    h.Name,
		Support: cloneSupport(h.Support),
	}
}

func clonePathSpecs(paths []HarnessPathSpec) []HarnessPathSpec {
	out := make([]HarnessPathSpec, len(paths))
	for i, path := range paths {
		out[i] = HarnessPathSpec{
			ID:        path.ID,
			Category:  path.Category,
			Kind:      path.Kind,
			Template:  path.Template,
			Platforms: append([]string(nil), path.Platforms...),
		}
	}
	return out
}

func cloneInstallations(installations []HarnessInstallation) []HarnessInstallation {
	out := make([]HarnessInstallation, len(installations))
	for i, installation := range installations {
		out[i] = HarnessInstallation{
			Method:      installation.Method,
			Package:     installation.Package,
			Command:     installation.Command,
			URL:         installation.URL,
			Marketplace: installation.Marketplace,
			ID:          installation.ID,
			Platforms:   append([]string(nil), installation.Platforms...),
			Notes:       installation.Notes,
		}
	}
	return out
}

func cloneHarnessDefinition(h HarnessDefinition) HarnessDefinition {
	return HarnessDefinition{
		Key:           h.Key,
		Name:          h.Name,
		Aliases:       append([]string(nil), h.Aliases...),
		Executables:   append([]string(nil), h.Executables...),
		Paths:         clonePathSpecs(h.Paths),
		Roots:         append([]HarnessRootDef(nil), h.Roots...),
		Support:       cloneSupport(h.Support),
		Env:           append([]HarnessEnvVar(nil), h.Env...),
		Sources:       append([]string(nil), h.Sources...),
		Installations: cloneInstallations(h.Installations),
	}
}

func cloneResolvedPaths(paths []ResolvedHarnessPath) []ResolvedHarnessPath {
	out := make([]ResolvedHarnessPath, len(paths))
	for i, path := range paths {
		out[i] = ResolvedHarnessPath{
			HarnessPathSpec: HarnessPathSpec{
				ID:        path.ID,
				Category:  path.Category,
				Kind:      path.Kind,
				Template:  path.Template,
				Platforms: append([]string(nil), path.Platforms...),
			},
			Path:   path.Path,
			Exists: path.Exists,
		}
	}
	return out
}

func normalizeKey(input string) string {
	return strings.ToLower(strings.TrimSpace(input))
}

func getHarnessDefinition(input string) (HarnessDefinition, bool) {
	loadMatrix()
	key := normalizeKey(input)
	for _, harness := range matrix.Harnesses {
		if normalizeKey(harness.Key) == key {
			return harness, true
		}
		for _, alias := range harness.Aliases {
			if normalizeKey(alias) == key {
				return harness, true
			}
		}
	}
	return HarnessDefinition{}, false
}

// CheckHarness checks a single harness by key or alias.
func CheckHarness(input string, options CheckOptions) (HarnessCheckResult, error) {
	harness, ok := getHarnessDefinition(input)
	if !ok {
		return HarnessCheckResult{}, errors.New("Unknown harness: " + input)
	}
	harness = cloneHarnessDefinition(harness)

	baseEnv := withDefaults(options.Env, options.CWD)
	env := resolveHarnessRoots(harness, baseEnv)
	executablePath := findExecutable(harness.Executables, env)
	paths := resolvePaths(harness, env)
	matchedPaths := make([]ResolvedHarnessPath, 0, len(paths))
	reasons := make([]string, 0)

	if executablePath != nil {
		reasons = append(reasons, "executable:"+filepath.Base(*executablePath))
	}

	for _, entry := range paths {
		if entry.Exists {
			matchedPaths = append(matchedPaths, entry)
			reasons = append(reasons, entry.Category+":"+entry.ID)
		}
	}

	return HarnessCheckResult{
		Key:            harness.Key,
		Name:           harness.Name,
		Installed:      executablePath != nil || len(matchedPaths) > 0,
		ExecutablePath: executablePath,
		Harness:        harness,
		Paths:          cloneResolvedPaths(paths),
		MatchedPaths:   cloneResolvedPaths(matchedPaths),
		Reasons:        append([]string(nil), reasons...),
	}, nil
}

// DetectHarnesses checks every harness in the matrix.
func DetectHarnesses(options CheckOptions) ([]HarnessCheckResult, error) {
	loadMatrix()
	results := make([]HarnessCheckResult, 0, len(matrix.Harnesses))
	for _, harness := range matrix.Harnesses {
		result, err := CheckHarness(harness.Key, options)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}

// DetectInstalledHarnesses returns the subset of DetectHarnesses
// results whose Installed field is true. It is equivalent to
// DetectHarnesses followed by a filter on Installed, but more
// ergonomic for the common case of "give me the installed harnesses."
func DetectInstalledHarnesses(options CheckOptions) ([]HarnessCheckResult, error) {
	all, err := DetectHarnesses(options)
	if err != nil {
		return nil, err
	}
	installed := make([]HarnessCheckResult, 0, len(all))
	for _, result := range all {
		if result.Installed {
			installed = append(installed, result)
		}
	}
	return installed, nil
}

// withDefaults computes the universal base-variable map (HOME, XDG_*, TMPDIR, CWD)
// plus any caller-supplied env vars. CWD comes only from the explicit option or
// the process working directory, matching the TypeScript package. Harness-specific
// derived roots are resolved separately by resolveHarnessRoots.
func withDefaults(env map[string]string, cwd string) map[string]string {
	if env == nil {
		env = processEnvMap()
	}

	out := make(map[string]string, len(env)+10)
	for k, v := range env {
		out[k] = v
	}

	home := env["HOME"]
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	if home == "" {
		home = "/"
	}

	xdgConfigHome := env["XDG_CONFIG_HOME"]
	if xdgConfigHome == "" {
		xdgConfigHome = filepath.Join(home, ".config")
	}
	xdgDataHome := env["XDG_DATA_HOME"]
	if xdgDataHome == "" {
		xdgDataHome = filepath.Join(home, ".local", "share")
	}
	xdgStateHome := env["XDG_STATE_HOME"]
	if xdgStateHome == "" {
		xdgStateHome = filepath.Join(home, ".local", "state")
	}
	xdgCacheHome := env["XDG_CACHE_HOME"]
	if xdgCacheHome == "" {
		xdgCacheHome = filepath.Join(home, ".cache")
	}

	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	if cwd == "" {
		cwd = "."
	}

	tmpdir := env["TMPDIR"]
	if tmpdir == "" {
		tmpdir = os.TempDir()
	}

	out["HOME"] = home
	out["USERPROFILE"] = first(env["USERPROFILE"], home)
	out["XDG_CONFIG_HOME"] = xdgConfigHome
	out["XDG_DATA_HOME"] = xdgDataHome
	out["XDG_STATE_HOME"] = xdgStateHome
	out["XDG_CACHE_HOME"] = xdgCacheHome
	out["TMPDIR"] = tmpdir
	out["CWD"] = cwd

	return out
}

// resolveHarnessRoots resolves the harness-specific derived template variables
// declared in harness.Roots. Resolution order follows declaration order so that
// later roots can reference earlier roots in their fallback and use templates.
func resolveHarnessRoots(harness HarnessDefinition, baseEnv map[string]string) map[string]string {
	out := make(map[string]string, len(baseEnv)+len(harness.Roots))
	for k, v := range baseEnv {
		out[k] = v
	}

	for _, root := range harness.Roots {
		var value string
		envVal := ""
		if root.Env != "" {
			envVal = baseEnv[root.Env]
		}

		if root.Env != "" && envVal != "" {
			// Env var is set. Resolve the "use" template if provided,
			// otherwise use the env var value directly.
			if root.Use != "" {
				// Build resolution context: baseEnv + resolved roots so far + the env var itself
				tmp := make(map[string]string, len(out)+1)
				for k, v := range out {
					tmp[k] = v
				}
				tmp[root.Env] = envVal
				value = resolveTemplate(root.Use, tmp)
			} else {
				value = envVal
			}
		} else {
			// Env var is not set. Resolve the fallback template.
			value = resolveTemplate(root.Fallback, out)
		}

		if value != "" {
			out[root.Name] = filepath.Clean(value)
		}
	}

	return out
}

func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

var templateVar = regexp.MustCompile(`\$\{([^}]+)\}`)

func resolveTemplate(template string, env map[string]string) string {
	if template == "" {
		return ""
	}

	unresolved := false
	resolved := templateVar.ReplaceAllStringFunc(template, func(match string) string {
		inner := match[2 : len(match)-1]
		value, ok := env[inner]
		if !ok || value == "" {
			unresolved = true
			return ""
		}
		return value
	})

	if unresolved {
		return ""
	}

	return filepath.Clean(resolved)
}

func platformMatches(platforms []string) bool {
	if len(platforms) == 0 {
		return true
	}
	current := currentPlatformValue()
	for _, p := range platforms {
		if p == current {
			return true
		}
	}
	return false
}

func currentPlatformValue() string {
	switch runtime.GOOS {
	case "windows":
		return "win32"
	default:
		return runtime.GOOS
	}
}

func pathTypeMatches(kind, candidatePath string) bool {
	stat, err := os.Stat(candidatePath)
	if err != nil {
		return false
	}
	if kind == "dir" {
		return stat.IsDir()
	}
	return !stat.IsDir()
}

func executableFileMatches(candidatePath string) bool {
	if !pathTypeMatches("file", candidatePath) {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	info, err := os.Stat(candidatePath)
	if err != nil {
		return false
	}
	return info.Mode().Perm()&0o111 != 0
}

func resolvePaths(harness HarnessDefinition, env map[string]string) []ResolvedHarnessPath {
	out := make([]ResolvedHarnessPath, 0, len(harness.Paths))
	for _, entry := range harness.Paths {
		if !platformMatches(entry.Platforms) {
			continue
		}
		resolved := resolveTemplate(entry.Template, env)
		exists := resolved != "" && pathTypeMatches(entry.Kind, resolved)
		out = append(out, ResolvedHarnessPath{
			HarnessPathSpec: HarnessPathSpec{
				ID:        entry.ID,
				Category:  entry.Category,
				Kind:      entry.Kind,
				Template:  entry.Template,
				Platforms: append([]string(nil), entry.Platforms...),
			},
			Path:   stringPointerOrNil(resolved),
			Exists: exists,
		})
	}
	return out
}

func findExecutable(executables []string, env map[string]string) *string {
	if len(executables) == 0 {
		return nil
	}

	pathValue := env["PATH"]
	pathParts := strings.Split(pathValue, string(filepath.ListSeparator))
	var exts []string
	if runtime.GOOS == "windows" {
		pathext := env["PATHEXT"]
		if pathext == "" {
			pathext = ".EXE;.CMD;.BAT;.COM"
		}
		exts = strings.Split(pathext, ";")
	} else {
		exts = []string{""}
	}

	for _, executable := range executables {
		for _, dir := range pathParts {
			if dir == "" {
				continue
			}
			for _, ext := range exts {
				candidate := filepath.Join(dir, executable+ext)
				if executableFileMatches(candidate) {
					return stringPointerOrNil(candidate)
				}
			}
		}
	}

	return nil
}

func stringPointerOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
