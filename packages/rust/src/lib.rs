//! Detect installed LLM harnesses and resolve their config/state paths from an
//! embedded JSON registry.
//!
//! This is a Rust port of the `@auron-labs/harness-detect` TypeScript package and
//! the Go package at `github.com/auron-labs/harness-detect/packages/golang/harnessdetect`.
//! It shares
//! the same harness registry (`data/harnesses.json`) and exposes the same
//! public API surface, adapted to idiomatic Rust naming.
//!
//! Detection is data-driven: a harness counts as **installed** when a matching
//! executable is found on `PATH` **or** one or more of its known
//! config/state/cache/install/project paths exist on disk. All harness-specific
//! behavior lives in the registry JSON; this crate contains no harness-specific
//! code paths.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The raw embedded registry JSON, compiled into the binary via `include_str!`.
/// Kept as a private constant so the sync test can compare it against the
/// canonical `packages/data/harnesses.json`.
static MATRIX_JSON: &str = include_str!("../data/harnesses.json");

static MATRIX: OnceLock<HarnessMatrix> = OnceLock::new();

fn matrix() -> &'static HarnessMatrix {
    MATRIX.get_or_init(|| {
        serde_json::from_str(MATRIX_JSON).expect("harnessdetect: failed to parse embedded matrix")
    })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A harness-relevant environment variable (documentation only — not read by
/// the detection logic).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessEnvVar {
    pub name: String,
    pub description: String,
}

/// One path template to check for a harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessPathSpec {
    pub id: String,
    pub category: String,
    pub kind: String,
    pub template: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
}

/// One support-related path template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessSupportPath {
    pub id: String,
    pub kind: String,
    pub template: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

/// One support capability leaf for one scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessSupportScope {
    pub status: String,
    pub paths: Vec<HarnessSupportPath>,
    pub sources: Vec<String>,
    pub confidence: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

/// One support capability area.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessSupportArea {
    pub global: HarnessSupportScope,
    pub local: HarnessSupportScope,
}

/// Support metadata for a harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessSupport {
    pub config: HarnessSupportArea,
    pub skills: HarnessSupportArea,
    pub commands: HarnessSupportArea,
    pub agents: HarnessSupportArea,
    #[serde(rename = "dotAgents")]
    pub dot_agents: HarnessSupportArea,
}

/// A local stdio command with discrete argv values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessAcpLaunch {
    pub command: String,
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
}

/// ACP metadata, independently of file-location support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessAcp {
    pub status: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub launches: Vec<HarnessAcpLaunch>,
    /// Launches that start the agent from a binary already on `PATH`; never a
    /// package runner.
    #[serde(
        default,
        rename = "installedLaunches",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub installed_launches: Vec<HarnessAcpLaunch>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub adapter: String,
    pub sources: Vec<String>,
    pub confidence: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

impl Default for HarnessAcp {
    fn default() -> Self {
        Self {
            status: "unknown".into(),
            launches: vec![],
            installed_launches: vec![],
            adapter: String::new(),
            sources: vec![],
            confidence: "unknown".into(),
            notes: String::new(),
        }
    }
}

/// One harness ACP entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessAcpRecord {
    pub key: String,
    pub name: String,
    pub acp: HarnessAcp,
}

/// A runnable ACP launch for an installed harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledAcpLaunch {
    pub key: String,
    pub name: String,
    /// Absolute path of the resolved executable.
    pub command: String,
    pub args: Vec<String>,
}

/// A derived template variable declared by a harness.
///
/// Roots are resolved in declaration order before path templates, allowing
/// later roots to reference earlier ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessRootDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub env: String,
    #[serde(rename = "use", default, skip_serializing_if = "String::is_empty")]
    pub use_: String,
    #[serde(
        rename = "fallbackEnv",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub fallback_env: String,
    pub fallback: String,
}

/// One documented installation method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessInstallation {
    pub method: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub package: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub command: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub marketplace: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

/// A single LLM harness definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessDefinition {
    pub key: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub executables: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub installations: Vec<HarnessInstallation>,
    pub paths: Vec<HarnessPathSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roots: Vec<HarnessRootDef>,
    pub support: HarnessSupport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acp: Option<HarnessAcp>,
    pub env: Vec<HarnessEnvVar>,
    pub sources: Vec<String>,
}

/// One harness support entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessSupportRecord {
    pub key: String,
    pub name: String,
    pub support: HarnessSupport,
}

/// The top-level registry document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessMatrix {
    pub version: u32,
    pub harnesses: Vec<HarnessDefinition>,
}

/// A resolved path entry: the original spec plus the resolved path and whether
/// it exists on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedHarnessPath {
    pub id: String,
    pub category: String,
    pub kind: String,
    pub template: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    /// `None` when a template placeholder was unresolved (the path is skipped).
    pub path: Option<String>,
    pub exists: bool,
}

/// Options passed to [`check_harness`] and [`detect_harnesses`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CheckOptions {
    /// When `Some`, replaces the process environment entirely (defaults are
    /// still filled in for `HOME`, `XDG_*`, `TMPDIR`, `CWD`).
    pub env: Option<HashMap<String, String>>,
    /// When `Some`, overrides the working directory (`${CWD}`).
    pub cwd: Option<String>,
}

/// The result of checking a single harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessCheckResult {
    pub key: String,
    pub name: String,
    pub installed: bool,
    pub executable_path: Option<String>,
    pub harness: HarnessDefinition,
    pub paths: Vec<ResolvedHarnessPath>,
    pub matched_paths: Vec<ResolvedHarnessPath>,
    pub reasons: Vec<String>,
}

/// Error returned by [`check_harness`] / [`detect_harnesses`] when a harness
/// key or alias is not found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessError(pub String);

impl std::fmt::Display for HarnessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for HarnessError {}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Returns a clone of the full registry.
pub fn get_raw_harness_data() -> HarnessMatrix {
    matrix().clone()
}

/// Returns a clone of the full registry.
pub fn get_harness_matrix() -> HarnessMatrix {
    get_raw_harness_data()
}

/// Returns a clone of the harness definitions slice.
pub fn list_harnesses() -> Vec<HarnessDefinition> {
    matrix().harnesses.clone()
}

/// Returns support metadata for one harness by key or alias.
pub fn get_harness_support(input: &str) -> Result<HarnessSupportRecord, HarnessError> {
    let harness = find_harness_definition(input)
        .ok_or_else(|| HarnessError(format!("Unknown harness: {}", input)))?;
    Ok(clone_harness_support_record(&harness))
}

/// Returns support metadata for all harnesses.
pub fn list_harness_support() -> Vec<HarnessSupportRecord> {
    matrix()
        .harnesses
        .iter()
        .map(clone_harness_support_record)
        .collect()
}

/// Returns ACP metadata for one harness by key or alias; missing metadata is unknown.
pub fn get_harness_acp(input: &str) -> Result<HarnessAcpRecord, HarnessError> {
    let harness = find_harness_definition(input)
        .ok_or_else(|| HarnessError(format!("Unknown harness: {}", input)))?;
    Ok(clone_harness_acp_record(&harness))
}

/// Returns ACP metadata for all harnesses.
pub fn list_harness_acp() -> Vec<HarnessAcpRecord> {
    matrix()
        .harnesses
        .iter()
        .map(clone_harness_acp_record)
        .collect()
}

fn clone_harness_acp_record(harness: &HarnessDefinition) -> HarnessAcpRecord {
    HarnessAcpRecord {
        key: harness.key.clone(),
        name: harness.name.clone(),
        acp: harness.acp.clone().unwrap_or_default(),
    }
}

/// Checks a single harness by key or alias (case-insensitive, trimmed).
///
/// Returns [`HarnessError`] with the message `"Unknown harness: <input>"` if
/// the key/alias is not found.
pub fn check_harness(
    input: &str,
    options: CheckOptions,
) -> Result<HarnessCheckResult, HarnessError> {
    let harness = find_harness_definition(input)
        .ok_or_else(|| HarnessError(format!("Unknown harness: {}", input)))?;

    let base_env = with_defaults(options.env.as_ref(), options.cwd.as_deref());
    let env = resolve_harness_roots(&harness, &base_env);
    let executable_path = find_executable(&harness.executables, &env, false);
    let paths = resolve_paths(&harness, &env);
    let matched_paths: Vec<ResolvedHarnessPath> =
        paths.iter().filter(|p| p.exists).cloned().collect();
    let mut reasons: Vec<String> = Vec::new();

    if let Some(ref exe) = executable_path {
        let basename = Path::new(exe)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        reasons.push(format!("executable:{}", basename));
    }

    for entry in &matched_paths {
        reasons.push(format!("{}:{}", entry.category, entry.id));
    }

    Ok(HarnessCheckResult {
        key: harness.key.clone(),
        name: harness.name.clone(),
        installed: executable_path.is_some() || !matched_paths.is_empty(),
        executable_path,
        harness,
        paths,
        matched_paths,
        reasons,
    })
}

/// Checks every harness in the registry, returning one result per entry.
pub fn detect_harnesses(options: CheckOptions) -> Result<Vec<HarnessCheckResult>, HarnessError> {
    let keys: Vec<String> = matrix().harnesses.iter().map(|h| h.key.clone()).collect();
    keys.into_iter()
        .map(|k| check_harness(&k, options.clone()))
        .collect()
}

/// Returns the subset of [`detect_harnesses`] results whose `installed` field
/// is `true`.
pub fn detect_installed_harnesses(
    options: CheckOptions,
) -> Result<Vec<HarnessCheckResult>, HarnessError> {
    let all = detect_harnesses(options)?;
    Ok(all.into_iter().filter(|r| r.installed).collect())
}

// ---------------------------------------------------------------------------
// Internal: lookup
// ---------------------------------------------------------------------------

/// Lists the ACP agents that can be started from binaries already installed.
///
/// An entry is returned when its ACP status is `supported`, it does not
/// delegate to an `adapter`, and the command of its launch for the current
/// platform resolves to an absolute executable path. Uses `installed_launches`
/// when present, otherwise `launches` that do not use a package runner. Nothing
/// is executed.
pub fn detect_installed_acp_launches(options: CheckOptions) -> Vec<InstalledAcpLaunch> {
    let env = with_defaults(options.env.as_ref(), options.cwd.as_deref());
    let mut results = Vec::new();

    for harness in &matrix().harnesses {
        let Some(acp) = harness.acp.as_ref() else {
            continue;
        };
        if acp.status != "supported" || !acp.adapter.is_empty() {
            continue;
        }

        let launches: Vec<&HarnessAcpLaunch> = if acp.installed_launches.is_empty() {
            acp.launches
                .iter()
                .filter(|l| !is_package_runner(l))
                .collect()
        } else {
            acp.installed_launches.iter().collect()
        };
        let Some(launch) = launches
            .into_iter()
            .find(|l| platform_matches(&l.platforms))
        else {
            continue;
        };
        if let Some(command) = find_executable(std::slice::from_ref(&launch.command), &env, true) {
            results.push(InstalledAcpLaunch {
                key: harness.key.clone(),
                name: harness.name.clone(),
                command,
                args: launch.args.clone(),
            });
        }
    }

    results
}

fn is_package_runner(launch: &HarnessAcpLaunch) -> bool {
    matches!(launch.command.as_str(), "npx" | "bunx" | "uvx")
        || (launch.command == "pnpm" && launch.args.first().is_some_and(|a| a == "dlx"))
}

fn find_harness_definition(input: &str) -> Option<HarnessDefinition> {
    let key = input.trim().to_lowercase();
    for harness in &matrix().harnesses {
        if harness.key.to_lowercase() == key {
            return Some(harness.clone());
        }
        if harness.aliases.iter().any(|a| a.to_lowercase() == key) {
            return Some(harness.clone());
        }
    }
    None
}

fn clone_harness_support_record(harness: &HarnessDefinition) -> HarnessSupportRecord {
    HarnessSupportRecord {
        key: harness.key.clone(),
        name: harness.name.clone(),
        support: harness.support.clone(),
    }
}

// ---------------------------------------------------------------------------
// Internal: environment defaults
// ---------------------------------------------------------------------------

/// Computes the universal base-variable map (`HOME`, `XDG_*`, `TMPDIR`, `CWD`)
/// plus any caller-supplied env vars. Harness-specific derived roots are
/// resolved separately by [`resolve_harness_roots`].
fn with_defaults(
    env: Option<&HashMap<String, String>>,
    cwd: Option<&str>,
) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = match env {
        Some(e) => e.clone(),
        None => std::env::vars().collect(),
    };

    let home = {
        let h = out.get("HOME").map(|s| s.as_str()).unwrap_or("");
        if !h.is_empty() {
            h.to_string()
        } else {
            std::env::var("HOME")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/".to_string())
        }
    };

    let userprofile = {
        let up = out.get("USERPROFILE").map(|s| s.as_str()).unwrap_or("");
        if !up.is_empty() {
            up.to_string()
        } else {
            home.clone()
        }
    };

    let xdg_config_home = out
        .get("XDG_CONFIG_HOME")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("{}/.config", home));
    let xdg_data_home = out
        .get("XDG_DATA_HOME")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("{}/.local/share", home));
    let xdg_state_home = out
        .get("XDG_STATE_HOME")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("{}/.local/state", home));
    let xdg_cache_home = out
        .get("XDG_CACHE_HOME")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("{}/.cache", home));

    let cwd_val = match cwd {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| ".".to_string()),
    };

    let tmpdir = out
        .get("TMPDIR")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned());

    out.insert("HOME".to_string(), home);
    out.insert("USERPROFILE".to_string(), userprofile);
    out.insert("XDG_CONFIG_HOME".to_string(), xdg_config_home);
    out.insert("XDG_DATA_HOME".to_string(), xdg_data_home);
    out.insert("XDG_STATE_HOME".to_string(), xdg_state_home);
    out.insert("XDG_CACHE_HOME".to_string(), xdg_cache_home);
    out.insert("TMPDIR".to_string(), tmpdir);
    out.insert("CWD".to_string(), cwd_val);

    out
}

// ---------------------------------------------------------------------------
// Internal: harness root resolution
// ---------------------------------------------------------------------------

/// Resolves the harness-specific derived template variables declared in
/// `harness.roots`. Resolution order follows declaration order so that later
/// roots can reference earlier roots in their `fallback` and `use` templates.
fn resolve_harness_roots(
    harness: &HarnessDefinition,
    base_env: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = base_env.clone();

    for root in &harness.roots {
        let env_val = if root.env.is_empty() {
            None
        } else {
            base_env.get(&root.env).map(|s| s.as_str())
        };
        let env_val_nonempty = env_val.filter(|s| !s.is_empty());
        let fallback_env_val = if root.fallback_env.is_empty() {
            None
        } else {
            base_env.get(&root.fallback_env).filter(|s| !s.is_empty())
        };

        let value: Option<String> = if !root.env.is_empty() {
            if let Some(val) = env_val_nonempty {
                if !root.use_.is_empty() {
                    // Resolve "use" against base env + resolved roots + the env var itself.
                    let mut tmp = out.clone();
                    tmp.insert(root.env.clone(), val.to_string());
                    resolve_template(&root.use_, &tmp)
                } else {
                    Some(val.to_string())
                }
            } else if let Some(val) = fallback_env_val {
                // Use the documented legacy override before the static fallback.
                Some(val.to_string())
            } else {
                resolve_template(&root.fallback, &out)
            }
        } else {
            resolve_template(&root.fallback, &out)
        };

        if let Some(v) = value {
            if !v.is_empty() {
                out.insert(
                    root.name.clone(),
                    normalize_path(&expand_leading_tilde(
                        &v,
                        base_env.get("HOME").map(String::as_str).unwrap_or(""),
                    )),
                );
            }
        }
    }

    out
}

fn expand_leading_tilde(value: &str, home: &str) -> String {
    if value == "~" {
        return home.to_string();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    if cfg!(windows) {
        if let Some(rest) = value.strip_prefix(r"~\") {
            return format!(r"{}\{}", home.trim_end_matches(['/', '\\']), rest);
        }
    }
    value.to_string()
}

// ---------------------------------------------------------------------------
// Internal: template resolution
// ---------------------------------------------------------------------------

/// Replaces all `${VAR}` placeholders with values from `env`.
///
/// If any placeholder value is missing or empty, the **entire template
/// resolves to `None`** (matching the TypeScript `null` / Go empty-string
/// semantics). The resolved string is normalized via [`normalize_path`].
fn resolve_template(template: &str, env: &HashMap<String, String>) -> Option<String> {
    if template.is_empty() {
        return None;
    }

    let mut result = String::with_capacity(template.len());
    let mut unresolved = false;
    let mut rest = template;

    while !rest.is_empty() {
        if let Some(start) = rest.find("${") {
            result.push_str(&rest[..start]);
            let after = &rest[start + 2..];
            if let Some(end) = after.find('}') {
                let name = &after[..end];
                match env.get(name) {
                    Some(v) if !v.is_empty() => result.push_str(v),
                    _ => unresolved = true,
                }
                rest = &after[end + 1..];
            } else {
                // Unclosed ${ — push literally.
                result.push_str("${");
                rest = after;
            }
        } else {
            result.push_str(rest);
            rest = "";
        }
    }

    if unresolved {
        return None;
    }

    Some(normalize_path(&result))
}

/// Normalizes a path string, mirroring Go's `filepath.Clean` / Node's
/// `path.normalize`: collapses repeated separators, removes `.` segments, and
/// resolves inner `..` segments where possible.
fn normalize_path(path: &str) -> String {
    let is_absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();

    for component in path.split('/') {
        match component {
            "" | "." => continue,
            ".." => {
                if let Some(last) = parts.last() {
                    if *last != ".." {
                        parts.pop();
                        continue;
                    }
                }
                if !is_absolute {
                    parts.push("..");
                }
                // For absolute paths, leading ".." is dropped (matches filepath.Clean).
            }
            _ => parts.push(component),
        }
    }

    let joined = parts.join("/");
    if is_absolute {
        if joined.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", joined)
        }
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

// ---------------------------------------------------------------------------
// Internal: platform + filesystem checks
// ---------------------------------------------------------------------------

/// Returns the current platform identifier using the Node.js convention
/// (`darwin`, `linux`, `win32`, …) so it matches the registry's `platforms[]`
/// values.
fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "freebsd") {
        "freebsd"
    } else {
        "unknown"
    }
}

fn platform_matches(platforms: &[String]) -> bool {
    if platforms.is_empty() {
        return true;
    }
    let plat = current_platform();
    platforms.iter().any(|p| p == plat)
}

fn path_type_matches(kind: &str, candidate_path: &str) -> bool {
    match fs::metadata(candidate_path) {
        Ok(meta) => {
            if kind == "dir" {
                meta.is_dir()
            } else {
                meta.is_file()
            }
        }
        Err(_) => false,
    }
}

#[cfg(unix)]
fn executable_file_matches(candidate_path: &str) -> bool {
    if !path_type_matches("file", candidate_path) {
        return false;
    }
    use std::os::unix::fs::PermissionsExt;
    match fs::metadata(candidate_path) {
        Ok(meta) => meta.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

#[cfg(windows)]
fn executable_file_matches(candidate_path: &str) -> bool {
    path_type_matches("file", candidate_path)
}

fn resolve_paths(
    harness: &HarnessDefinition,
    env: &HashMap<String, String>,
) -> Vec<ResolvedHarnessPath> {
    harness
        .paths
        .iter()
        .filter(|entry| platform_matches(&entry.platforms))
        .map(|entry| {
            let resolved = resolve_template(&entry.template, env);
            let exists = resolved
                .as_ref()
                .map(|p| path_type_matches(&entry.kind, p))
                .unwrap_or(false);
            ResolvedHarnessPath {
                id: entry.id.clone(),
                category: entry.category.clone(),
                kind: entry.kind.clone(),
                template: entry.template.clone(),
                platforms: entry.platforms.clone(),
                path: resolved,
                exists,
            }
        })
        .collect()
}

/// Searches `PATH` for the first matching executable. With `absolute_only`,
/// relative `PATH` entries are ignored.
fn find_executable(
    executables: &[String],
    env: &HashMap<String, String>,
    absolute_only: bool,
) -> Option<String> {
    if executables.is_empty() {
        return None;
    }

    let path_value = env.get("PATH").map(|s| s.as_str()).unwrap_or("");
    let delimiter = if cfg!(windows) { ';' } else { ':' };
    let path_parts: Vec<&str> = path_value
        .split(delimiter)
        .filter(|s| !s.is_empty() && (!absolute_only || Path::new(s).is_absolute()))
        .collect();

    let exts: Vec<String> = if cfg!(windows) {
        let pathext = env
            .get("PATHEXT")
            .map(|s| s.as_str())
            .unwrap_or(".EXE;.CMD;.BAT;.COM");
        pathext.split(';').map(|s| s.to_string()).collect()
    } else {
        vec![String::new()]
    };

    for executable in executables {
        for dir in &path_parts {
            for ext in &exts {
                let candidate = if cfg!(windows) {
                    Path::new(dir).join(format!("{}{}", executable, ext))
                } else {
                    Path::new(dir).join(executable)
                };
                let candidate_str = candidate.to_string_lossy().into_owned();
                if executable_file_matches(&candidate_str) {
                    return Some(candidate_str);
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_basic() {
        assert_eq!(normalize_path("/a/b/c"), "/a/b/c");
        assert_eq!(normalize_path("/a//b/./c"), "/a/b/c");
        assert_eq!(normalize_path("/a/b/../c"), "/a/c");
        assert_eq!(normalize_path("a/b/../c"), "a/c");
        assert_eq!(normalize_path("/.."), "/");
        assert_eq!(normalize_path(""), ".");
    }

    #[test]
    fn resolve_template_unresolved_returns_none() {
        let mut env = HashMap::new();
        env.insert("HOME".to_string(), "/Users/test".to_string());
        // CODEX_ROOT is unset → whole template is None.
        assert_eq!(resolve_template("${CODEX_ROOT}/config.toml", &env), None);
        assert_eq!(
            resolve_template("${HOME}/.codex/config.toml", &env),
            Some("/Users/test/.codex/config.toml".to_string())
        );
    }

    #[test]
    fn acp_synthetic_public_flows() {
        // Unit tests have a separate binary from integration tests using the real registry.
        let fixture_json = fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/acp-registry.json"),
        )
        .expect("read ACP fixture");
        let fixture: HarnessMatrix = serde_json::from_str(&fixture_json).unwrap();
        MATRIX
            .set(fixture.clone())
            .expect("unit-test matrix must be unused");
        assert_eq!(get_raw_harness_data(), fixture);
        assert_eq!(get_harness_acp(" NATIVE-ALIAS ").unwrap().key, "native");
        assert_eq!(
            get_harness_acp("absent").unwrap_err().0,
            "Unknown harness: absent"
        );
        let host = get_harness_acp("host").unwrap();
        let bridge = get_harness_acp(&host.acp.adapter).unwrap();
        assert_eq!(bridge.acp.launches[0].command, "example-bridge");
        assert_eq!(
            serde_json::to_value(&bridge).unwrap()["acp"]["launches"][0]["args"],
            serde_json::json!([])
        );
        for key in ["unknown", "missing"] {
            assert_eq!(get_harness_acp(key).unwrap().acp, HarnessAcp::default());
        }
        assert_eq!(
            get_harness_acp("unsupported").unwrap().acp.status,
            "unsupported"
        );
        let mut records = list_harness_acp();
        assert_eq!(records.len(), fixture.harnesses.len());
        records[0]
            .acp
            .sources
            .push("https://example.com/mutated".into());
        let launch = &mut records[0].acp.launches[0];
        launch.args.push("mutated".into());
        launch.platforms.push("win32".into());
        records[0].acp.launches[1].args.push("mutated".into());
        for mut harness in list_harnesses() {
            let options = CheckOptions {
                env: Some(HashMap::from([("PATH".into(), "".into())])),
                cwd: None,
            };
            let mut result = check_harness(&harness.key, options).unwrap();
            assert!(!result.installed, "ACP is not detection evidence");
            assert_eq!(result.harness, harness);
            if harness.key == "missing" {
                assert!(serde_json::to_value(&result).unwrap()["harness"]
                    .get("acp")
                    .is_none());
            }
            if let Some(acp) = harness.acp.as_mut() {
                acp.sources.push("mutated".into());
            }
            if let Some(acp) = result.harness.acp.as_mut() {
                acp.sources.push("mutated".into());
            }
        }
        let mut raw = get_raw_harness_data();
        raw.harnesses[0].acp.as_mut().unwrap().launches[0].command = "mutated".into();
        assert_eq!(get_raw_harness_data(), fixture);
        assert_eq!(
            get_harness_acp("native").unwrap().acp,
            fixture.harnesses[0].acp.clone().unwrap()
        );
        assert!(serde_json::to_value(get_harness_support("native").unwrap())
            .unwrap()
            .get("acp")
            .is_none());
    }
}
