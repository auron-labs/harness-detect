package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/auron/harness-detect/packages/golang/harnessdetect"
)

type parityInput struct {
	Version *int          `json:"version"`
	Cases   []fixtureCase `json:"cases"`
}

type sandboxRoots struct {
	TMP  string
	HOME string
	CWD  string
	BIN  string
}

type fixtureCase struct {
	ID        string            `json:"id"`
	Operation string            `json:"operation"`
	Input     string            `json:"input,omitempty"`
	Platforms []string          `json:"platforms,omitempty"`
	CWD       string            `json:"cwd,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Setup     []fixtureSetup    `json:"setup,omitempty"`
}

type fixtureSetup struct {
	Type    string `json:"type"`
	Path    string `json:"path"`
	Content string `json:"content,omitempty"`
}

type snapshot struct {
	Version *int           `json:"version"`
	Cases   []snapshotCase `json:"cases"`
}

type snapshotCase struct {
	ID        string      `json:"id"`
	Operation string      `json:"operation"`
	Skipped   bool        `json:"skipped,omitempty"`
	Result    interface{} `json:"result,omitempty"`
}

type normalizedCheckResult struct {
	Key            string                 `json:"key"`
	Installed      bool                   `json:"installed"`
	ExecutablePath *string                `json:"executablePath"`
	MatchedPathIDs []string               `json:"matchedPathIds"`
	Paths          []normalizedPathResult `json:"paths"`
}

type normalizedPathResult struct {
	ID     string  `json:"id"`
	Path   *string `json:"path"`
	Exists bool    `json:"exists"`
}

type normalizedDetectResult struct {
	Count          int                     `json:"count"`
	InstalledCount int                     `json:"installedCount"`
	InstalledKeys  []string                `json:"installedKeys"`
	Results        []normalizedCheckResult `json:"results"`
}

type normalizedSupportPath struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Template    string   `json:"template"`
	Platforms   []string `json:"platforms"`
	Description *string  `json:"description"`
}

type normalizedSupportLeaf struct {
	Status     string                  `json:"status"`
	Confidence string                  `json:"confidence"`
	Notes      *string                 `json:"notes"`
	Sources    []string                `json:"sources"`
	Paths      []normalizedSupportPath `json:"paths"`
}

type normalizedSupportArea struct {
	Global normalizedSupportLeaf `json:"global"`
	Local  normalizedSupportLeaf `json:"local"`
}

type normalizedSupport struct {
	Config    normalizedSupportArea `json:"config"`
	Skills    normalizedSupportArea `json:"skills"`
	Commands  normalizedSupportArea `json:"commands"`
	Agents    normalizedSupportArea `json:"agents"`
	DotAgents normalizedSupportArea `json:"dotAgents"`
}

type normalizedSupportRecord struct {
	Key     string            `json:"key"`
	Name    string            `json:"name"`
	Support normalizedSupport `json:"support"`
}

type normalizedSupportList struct {
	Count   int                       `json:"count"`
	Records []normalizedSupportRecord `json:"records"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "paritysnapshot: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	raw, err := readInput()
	if err != nil {
		return err
	}

	input, err := parseInput(raw)
	if err != nil {
		return err
	}

	roots, err := createSandbox()
	if err != nil {
		return err
	}
	defer os.RemoveAll(roots.TMP)

	out := snapshot{
		Cases:   make([]snapshotCase, 0, len(input.Cases)),
		Version: input.Version,
	}

	for _, c := range input.Cases {
		result, err := runCase(c, roots)
		if err != nil {
			return fmt.Errorf("case %s: %w", c.ID, err)
		}
		out.Cases = append(out.Cases, result)
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(out)
}

func createSandbox() (sandboxRoots, error) {
	tempRoot, err := os.MkdirTemp("", "harness-detect-parity-")
	if err != nil {
		return sandboxRoots{}, fmt.Errorf("create parity sandbox: %w", err)
	}

	roots := sandboxRoots{
		TMP:  tempRoot,
		HOME: filepath.Join(tempRoot, "home"),
		CWD:  filepath.Join(tempRoot, "cwd"),
		BIN:  filepath.Join(tempRoot, "bin"),
	}

	for _, dirPath := range []string{roots.TMP, roots.HOME, roots.CWD, roots.BIN} {
		if err := os.MkdirAll(dirPath, 0o755); err != nil {
			_ = os.RemoveAll(tempRoot)
			return sandboxRoots{}, fmt.Errorf("create parity sandbox dir %s: %w", dirPath, err)
		}
	}

	return roots, nil
}

func readInput() ([]byte, error) {
	if len(os.Args) > 1 && os.Args[1] != "-" {
		data, err := os.ReadFile(os.Args[1])
		if err != nil {
			return nil, fmt.Errorf("read input file: %w", err)
		}
		return data, nil
	}

	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return nil, fmt.Errorf("read stdin: %w", err)
	}
	return data, nil
}

func parseInput(raw []byte) (parityInput, error) {
	if len(raw) == 0 || len(bytesTrimSpace(raw)) == 0 {
		return parityInput{}, fmt.Errorf("expected JSON parity cases from stdin or a file path argument")
	}

	var objectInput parityInput
	if err := json.Unmarshal(raw, &objectInput); err == nil && objectInput.Cases != nil {
		return objectInput, nil
	}

	var arrayInput []fixtureCase
	if err := json.Unmarshal(raw, &arrayInput); err != nil {
		return parityInput{}, fmt.Errorf("parity input must be an array of cases or an object with a cases array")
	}

	return parityInput{Cases: arrayInput}, nil
}

func runCase(rawCase fixtureCase, roots sandboxRoots) (snapshotCase, error) {
	c := expandCase(rawCase, roots)
	result := snapshotCase{ID: c.ID, Operation: c.Operation}

	if len(c.Platforms) > 0 && !contains(c.Platforms, runtime.GOOS) {
		result.Skipped = true
		return result, nil
	}

	expandedEnv := make(map[string]string, len(c.Env))
	for key, value := range c.Env {
		expandedEnv[key] = value
	}

	setup, err := prepareSetup(c.Setup, roots.TMP)
	if err != nil {
		return snapshotCase{}, err
	}

	applied := make([]fixtureSetup, 0, len(setup))
	for _, step := range setup {
		if err := applySetup(step); err != nil {
			cleanupSetup(applied)
			return snapshotCase{}, err
		}
		applied = append(applied, step)
	}
	defer cleanupSetup(applied)

	options := harnessdetect.CheckOptions{Env: expandedEnv, CWD: c.CWD}

	switch c.Operation {
	case "checkHarness":
		actual, err := harnessdetect.CheckHarness(c.Input, options)
		if err != nil {
			return snapshotCase{}, fmt.Errorf("checkHarness(%q): %w", c.Input, err)
		}
		result.Result = normalizeCheckResult(actual, roots)
		return result, nil
	case "detectHarnesses":
		actual, err := harnessdetect.DetectHarnesses(options)
		if err != nil {
			return snapshotCase{}, fmt.Errorf("detectHarnesses: %w", err)
		}
		result.Result = normalizeDetectResult(actual, roots)
		return result, nil
	case "getHarnessSupport":
		actual, err := harnessdetect.GetHarnessSupport(c.Input)
		if err != nil {
			return snapshotCase{}, fmt.Errorf("getHarnessSupport(%q): %w", c.Input, err)
		}
		result.Result = normalizeSupportRecord(actual)
		return result, nil
	case "listHarnessSupport":
		result.Result = normalizeSupportList(harnessdetect.ListHarnessSupport())
		return result, nil
	default:
		return snapshotCase{}, fmt.Errorf("unsupported operation %q", c.Operation)
	}
}

func expandCase(c fixtureCase, roots sandboxRoots) fixtureCase {
	expanded := fixtureCase{
		ID:        c.ID,
		Operation: c.Operation,
		Input:     expandString(c.Input, roots),
		CWD:       expandString(c.CWD, roots),
		Platforms: append([]string(nil), c.Platforms...),
	}

	if len(c.Env) > 0 {
		expanded.Env = make(map[string]string, len(c.Env))
		for key, value := range c.Env {
			expanded.Env[key] = expandString(value, roots)
		}
	}

	if len(c.Setup) > 0 {
		expanded.Setup = make([]fixtureSetup, 0, len(c.Setup))
		for _, step := range c.Setup {
			expanded.Setup = append(expanded.Setup, fixtureSetup{
				Type:    step.Type,
				Path:    expandString(step.Path, roots),
				Content: expandString(step.Content, roots),
			})
		}
	}

	return expanded
}

func expandString(value string, roots sandboxRoots) string {
	replacer := strings.NewReplacer(
		"${TMP}", roots.TMP,
		"${HOME}", roots.HOME,
		"${CWD}", roots.CWD,
		"${BIN}", roots.BIN,
	)
	return replacer.Replace(value)
}

func normalizePathValue(value *string, roots sandboxRoots) *string {
	if value == nil {
		return nil
	}

	resolvedValue, err := filepath.Abs(*value)
	if err != nil {
		copy := *value
		return &copy
	}

	replacements := []struct {
		placeholder string
		root        string
	}{
		{placeholder: "${HOME}", root: roots.HOME},
		{placeholder: "${CWD}", root: roots.CWD},
		{placeholder: "${BIN}", root: roots.BIN},
		{placeholder: "${TMP}", root: roots.TMP},
	}

	normalized := resolvedValue
	for _, replacement := range replacements {
		rootPath, rootErr := filepath.Abs(replacement.root)
		if rootErr != nil {
			continue
		}
		if normalized == rootPath || strings.HasPrefix(normalized, rootPath+string(os.PathSeparator)) {
			normalized = replacement.placeholder + normalized[len(rootPath):]
			break
		}
	}

	copy := normalized
	return &copy
}

func applySetup(step fixtureSetup) error {
	switch step.Type {
	case "dir":
		if err := os.MkdirAll(step.Path, 0o755); err != nil {
			return fmt.Errorf("setup dir %s: %w", step.Path, err)
		}
		return nil
	case "file":
		if err := os.MkdirAll(filepath.Dir(step.Path), 0o755); err != nil {
			return fmt.Errorf("setup file parent %s: %w", filepath.Dir(step.Path), err)
		}
		if err := os.WriteFile(step.Path, []byte(step.Content), 0o644); err != nil {
			return fmt.Errorf("setup file %s: %w", step.Path, err)
		}
		return nil
	case "executable":
		if err := os.MkdirAll(filepath.Dir(step.Path), 0o755); err != nil {
			return fmt.Errorf("setup executable parent %s: %w", filepath.Dir(step.Path), err)
		}
		mode := os.FileMode(0o644)
		if runtime.GOOS != "windows" {
			mode = 0o755
		}
		if err := os.WriteFile(step.Path, []byte(step.Content), mode); err != nil {
			return fmt.Errorf("setup executable %s: %w", step.Path, err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported setup type %q", step.Type)
	}
}

func prepareSetup(setup []fixtureSetup, tempRoot string) ([]fixtureSetup, error) {
	prepared := make([]fixtureSetup, 0, len(setup))
	for _, step := range setup {
		resolvedPath, err := resolveSandboxPath(step.Path, tempRoot)
		if err != nil {
			return nil, err
		}
		step.Path = resolvedPath
		prepared = append(prepared, step)
	}
	return prepared, nil
}

func resolveSandboxPath(targetPath string, tempRoot string) (string, error) {
	if targetPath == "" {
		return "", fmt.Errorf("parity setup entries must include a non-empty path")
	}
	if tempRoot == "" {
		return "", fmt.Errorf("parity setup path requires a tempRoot sandbox: %s", targetPath)
	}

	sandboxRealPath, err := filepath.EvalSymlinks(tempRoot)
	if err != nil {
		return "", fmt.Errorf("resolve tempRoot %s: %w", tempRoot, err)
	}

	absoluteTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		return "", fmt.Errorf("resolve setup path %s: %w", targetPath, err)
	}

	missingSegments := make([]string, 0)
	existingPath := absoluteTargetPath
	for {
		info, statErr := os.Lstat(existingPath)
		if statErr == nil {
			if existingPath == absoluteTargetPath && info.Mode()&os.ModeSymlink != 0 {
				return "", fmt.Errorf("refusing parity setup symlink target: %s", targetPath)
			}
			break
		}
		if !os.IsNotExist(statErr) {
			return "", fmt.Errorf("inspect setup path %s: %w", targetPath, statErr)
		}

		parentPath := filepath.Dir(existingPath)
		if parentPath == existingPath {
			return "", fmt.Errorf("could not resolve a parity setup parent for %s", targetPath)
		}

		missingSegments = append([]string{filepath.Base(existingPath)}, missingSegments...)
		existingPath = parentPath
	}

	resolvedExistingPath, err := filepath.EvalSymlinks(existingPath)
	if err != nil {
		return "", fmt.Errorf("resolve setup parent %s: %w", existingPath, err)
	}

	resolvedTargetPath := filepath.Join(append([]string{resolvedExistingPath}, missingSegments...)...)
	insideSandbox, err := isWithinRoot(sandboxRealPath, resolvedTargetPath)
	if err != nil {
		return "", err
	}
	if !insideSandbox {
		return "", fmt.Errorf("parity setup path escapes temp root: %s", targetPath)
	}

	return absoluteTargetPath, nil
}

func isWithinRoot(rootPath string, candidatePath string) (bool, error) {
	relativePath, err := filepath.Rel(rootPath, candidatePath)
	if err != nil {
		return false, fmt.Errorf("compare sandbox path %s to %s: %w", candidatePath, rootPath, err)
	}
	return relativePath == "." || relativePath == "" || (!strings.HasPrefix(relativePath, "..") && relativePath != ".."), nil
}

func cleanupSetup(setup []fixtureSetup) {
	for i := len(setup) - 1; i >= 0; i-- {
		step := setup[i]
		if step.Path == "" {
			continue
		}
		if _, err := os.Stat(step.Path); err != nil {
			continue
		}
		if step.Type == "dir" {
			_ = os.RemoveAll(step.Path)
			continue
		}
		_ = os.Remove(step.Path)
	}
}

func normalizeCheckResult(result harnessdetect.HarnessCheckResult, roots sandboxRoots) *normalizedCheckResult {
	matchedPathIDs := make([]string, 0, len(result.MatchedPaths))
	for _, path := range result.MatchedPaths {
		matchedPathIDs = append(matchedPathIDs, path.ID)
	}
	sort.Strings(matchedPathIDs)

	paths := make([]normalizedPathResult, 0, len(result.Paths))
	for _, path := range result.Paths {
		paths = append(paths, normalizedPathResult{
			ID:     path.ID,
			Path:   normalizePathValue(path.Path, roots),
			Exists: path.Exists,
		})
	}
	sort.Slice(paths, func(i, j int) bool {
		return paths[i].ID < paths[j].ID
	})

	return &normalizedCheckResult{
		Key:            result.Key,
		Installed:      result.Installed,
		ExecutablePath: normalizePathValue(result.ExecutablePath, roots),
		MatchedPathIDs: matchedPathIDs,
		Paths:          paths,
	}
}

func normalizeDetectResult(results []harnessdetect.HarnessCheckResult, roots sandboxRoots) *normalizedDetectResult {
	normalizedResults := make([]normalizedCheckResult, 0, len(results))
	for _, result := range results {
		normalized := normalizeCheckResult(result, roots)
		if normalized != nil {
			normalizedResults = append(normalizedResults, *normalized)
		}
	}
	sort.Slice(normalizedResults, func(i, j int) bool {
		return normalizedResults[i].Key < normalizedResults[j].Key
	})

	installedKeys := make([]string, 0)
	for _, result := range normalizedResults {
		if result.Installed {
			installedKeys = append(installedKeys, result.Key)
		}
	}
	sort.Strings(installedKeys)

	return &normalizedDetectResult{
		Count:          len(results),
		InstalledCount: len(installedKeys),
		InstalledKeys:  installedKeys,
		Results:        normalizedResults,
	}
}

func normalizeSupportPath(path harnessdetect.HarnessSupportPath) normalizedSupportPath {
	platforms := append([]string(nil), path.Platforms...)
	sort.Strings(platforms)

	var description *string
	if path.Description != "" {
		copy := path.Description
		description = &copy
	}

	return normalizedSupportPath{
		ID:          path.ID,
		Kind:        path.Kind,
		Template:    path.Template,
		Platforms:   platforms,
		Description: description,
	}
}

func normalizeSupportLeaf(leaf harnessdetect.HarnessSupportScope) normalizedSupportLeaf {
	paths := make([]normalizedSupportPath, 0, len(leaf.Paths))
	for _, path := range leaf.Paths {
		paths = append(paths, normalizeSupportPath(path))
	}
	sort.Slice(paths, func(i, j int) bool {
		return paths[i].ID < paths[j].ID
	})

	sources := make([]string, 0, len(leaf.Sources))
	sources = append(sources, leaf.Sources...)
	sort.Strings(sources)

	var notes *string
	if leaf.Notes != "" {
		copy := leaf.Notes
		notes = &copy
	}

	return normalizedSupportLeaf{
		Status:     leaf.Status,
		Confidence: leaf.Confidence,
		Notes:      notes,
		Sources:    sources,
		Paths:      paths,
	}
}

func normalizeSupportArea(area harnessdetect.HarnessSupportArea) normalizedSupportArea {
	return normalizedSupportArea{
		Global: normalizeSupportLeaf(area.Global),
		Local:  normalizeSupportLeaf(area.Local),
	}
}

func normalizeSupport(support harnessdetect.HarnessSupport) normalizedSupport {
	return normalizedSupport{
		Config:    normalizeSupportArea(support.Config),
		Skills:    normalizeSupportArea(support.Skills),
		Commands:  normalizeSupportArea(support.Commands),
		Agents:    normalizeSupportArea(support.Agents),
		DotAgents: normalizeSupportArea(support.DotAgents),
	}
}

func normalizeSupportRecord(record harnessdetect.HarnessSupportRecord) normalizedSupportRecord {
	return normalizedSupportRecord{
		Key:     record.Key,
		Name:    record.Name,
		Support: normalizeSupport(record.Support),
	}
}

func normalizeSupportList(records []harnessdetect.HarnessSupportRecord) *normalizedSupportList {
	normalizedRecords := make([]normalizedSupportRecord, 0, len(records))
	for _, record := range records {
		normalized := normalizeSupportRecord(record)
		normalizedRecords = append(normalizedRecords, normalized)
	}
	sort.Slice(normalizedRecords, func(i, j int) bool {
		return normalizedRecords[i].Key < normalizedRecords[j].Key
	})

	return &normalizedSupportList{
		Count:   len(normalizedRecords),
		Records: normalizedRecords,
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func bytesTrimSpace(raw []byte) []byte {
	start := 0
	for start < len(raw) && isSpace(raw[start]) {
		start++
	}
	end := len(raw)
	for end > start && isSpace(raw[end-1]) {
		end--
	}
	return raw[start:end]
}

func isSpace(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r':
		return true
	default:
		return false
	}
}
