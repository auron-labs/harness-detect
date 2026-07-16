//! Behavior tests mirroring the TypeScript and Go packages.
//!
//! These tests exercise the public API only and run as integration tests
//! (CWD = the package root, `packages/rust`).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use harness_detect::{
    check_harness, detect_harnesses, detect_installed_harnesses, get_harness_matrix,
    get_harness_support, list_harness_support, list_harnesses, CheckOptions, HarnessCheckResult,
    HarnessSupportRecord, ResolvedHarnessPath,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "harness-detect-{}-{}",
        std::process::id(),
        rand_suffix()
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn rand_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

fn cleanup(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
}

fn find_path<'a>(result: &'a HarnessCheckResult, id: &'a str) -> Option<&'a ResolvedHarnessPath> {
    result.paths.iter().find(|p| p.id == id)
}

fn env_home(home: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("HOME".to_string(), home.to_string());
    env.insert("PATH".to_string(), String::new());
    env
}

fn find_harness_support_record<'a>(
    records: &'a [HarnessSupportRecord],
    key: &'a str,
) -> Option<&'a HarnessSupportRecord> {
    records.iter().find(|record| record.key == key)
}

// ---------------------------------------------------------------------------
// Registry sync
// ---------------------------------------------------------------------------

#[test]
fn embedded_data_matches_shared_file() {
    // The embedded JSON is include_str!'d relative to src/lib.rs → ../data/
    let embedded = include_str!("../data/harnesses.json");
    let shared_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
        .join("harnesses.json");
    let shared = fs::read_to_string(&shared_path).unwrap_or_else(|e| {
        panic!(
            "could not read shared harnesses.json at {:?}: {}",
            shared_path, e
        )
    });
    assert_eq!(
        embedded, shared,
        "packages/rust/data/harnesses.json must match packages/data/harnesses.json byte-for-byte; \
         refresh packages/rust/data/harnesses.json from packages/data/harnesses.json"
    );
}

// ---------------------------------------------------------------------------
// Matrix readability
// ---------------------------------------------------------------------------

#[test]
fn test_get_harness_matrix() {
    let matrix = get_harness_matrix();
    assert_eq!(matrix.version, 1);
    assert!(
        matrix.harnesses.len() >= 10,
        "expected at least 10 harnesses, got {}",
        matrix.harnesses.len()
    );
}

#[test]
fn test_list_harnesses() {
    let matrix = get_harness_matrix();
    let harnesses = list_harnesses();
    assert_eq!(
        harnesses.len(),
        matrix.harnesses.len(),
        "list length mismatch"
    );
}

#[test]
fn test_support_api_matches_matrix_shape() {
    let matrix = get_harness_matrix();
    let support_list = list_harness_support();

    assert_eq!(
        support_list.len(),
        matrix.harnesses.len(),
        "support list length mismatch"
    );

    for harness in &matrix.harnesses {
        let record = find_harness_support_record(&support_list, &harness.key)
            .unwrap_or_else(|| panic!("missing support record for {}", harness.key));
        assert_eq!(
            record.name, harness.name,
            "support name mismatch for {}",
            harness.key
        );
        assert_eq!(
            record.support, harness.support,
            "support record mismatch for {}",
            harness.key
        );

        let support_record = get_harness_support(&harness.key).unwrap_or_else(|e| {
            panic!("unexpected support lookup error for {}: {}", harness.key, e)
        });
        assert_eq!(
            support_record.support, harness.support,
            "support lookup mismatch for {}",
            harness.key
        );
    }
}

#[test]
fn test_support_api_returns_cloned_data() {
    let canonical = get_harness_matrix()
        .harnesses
        .into_iter()
        .find(|harness| harness.key == "codex")
        .expect("missing codex harness");
    let canonical_support = canonical.support;

    let mut first = get_harness_support("codex").expect("support lookup");
    first.support.config.global.status = "mutated".to_string();
    first.support.config.global.paths[0].template = "/tmp/mutated".to_string();
    first
        .support
        .commands
        .local
        .sources
        .push("https://example.com/mutated".to_string());

    let mut listed = find_harness_support_record(&list_harness_support(), "codex")
        .expect("codex support record missing")
        .support
        .clone();
    listed.skills.local.confidence = "mutated".to_string();
    listed.dot_agents.global.status = "mutated".to_string();

    let second = get_harness_support("codex").expect("second support lookup");
    let listed_again = find_harness_support_record(&list_harness_support(), "codex")
        .expect("codex support record missing on second list")
        .support
        .clone();

    assert_eq!(
        second.support, canonical_support,
        "mutating prior support lookup affected later call"
    );
    assert_eq!(
        listed_again, canonical_support,
        "mutating listed support affected later list call"
    );
}

#[test]
fn test_get_harness_support_unknown() {
    let err =
        get_harness_support("nonexistent-harness").expect_err("expected support lookup error");
    assert_eq!(err.to_string(), "Unknown harness: nonexistent-harness");
}

// ---------------------------------------------------------------------------
// Env override resolution
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_resolves_env_overrides() {
    let mut env = env_home("/Users/test");
    env.insert("CODEX_HOME".to_string(), "/tmp/codex-home".to_string());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    let config = find_path(&result, "config").expect("missing config path");
    let project = find_path(&result, "project-config").expect("missing project-config path");

    assert_eq!(config.path.as_deref(), Some("/tmp/codex-home/config.toml"));
    assert_eq!(project.path.as_deref(), Some("/repo/.codex/config.toml"));
}

#[test]
fn test_check_harness_ignores_env_cwd_when_option_unset() {
    let cwd = std::env::current_dir().expect("get current dir");
    let mut env = env_home("/Users/test");
    env.insert("CWD".to_string(), "/wrong".to_string());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: None,
        },
    )
    .expect("unexpected error");

    let project = find_path(&result, "project-config").expect("missing project-config path");
    let want = cwd.join(".codex").join("config.toml");

    assert_eq!(
        project.path.as_deref(),
        Some(want.to_string_lossy().as_ref())
    );
}

#[test]
fn test_check_harness_resolves_derived_roots() {
    let mut env = env_home("/Users/test");
    env.insert("HERMES_HOME".to_string(), "/tmp/hermes-home".to_string());

    let result = check_harness(
        "hermes-agent",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    let config = find_path(&result, "config").expect("missing config path");
    let sessions = find_path(&result, "sessions").expect("missing sessions path");

    assert_eq!(config.path.as_deref(), Some("/tmp/hermes-home/config.yaml"));
    assert_eq!(sessions.path.as_deref(), Some("/tmp/hermes-home/sessions"));
}

// ---------------------------------------------------------------------------
// Alias lookup
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_aliases_match() {
    let opts = CheckOptions {
        env: Some(env_home("/Users/test")),
        cwd: Some("/repo".to_string()),
    };

    let by_key = check_harness("claude-code", opts.clone()).expect("byKey error");
    let by_alias = check_harness("claude", opts).expect("byAlias error");

    assert_eq!(by_key.key, by_alias.key, "alias mismatch");
}

// ---------------------------------------------------------------------------
// Full-registry iteration
// ---------------------------------------------------------------------------

#[test]
fn test_detect_harnesses_checks_all() {
    let all = detect_harnesses(CheckOptions {
        env: Some(env_home("/Users/test")),
        cwd: Some("/repo".to_string()),
    })
    .expect("unexpected error");

    assert_eq!(all.len(), list_harnesses().len());
}

#[test]
fn test_detect_installed_harnesses_only_installed() {
    let tmp = temp_dir();
    let claude_dir = tmp.join(".claude");
    fs::create_dir_all(&claude_dir).expect("mkdir");
    fs::write(claude_dir.join("settings.json"), "{}").expect("write file");

    let env = env_home(tmp.to_str().unwrap());
    let opts = CheckOptions {
        env: Some(env),
        cwd: Some("/repo".to_string()),
    };

    let installed = detect_installed_harnesses(opts.clone()).expect("detect installed");
    let all = detect_harnesses(opts).expect("detect all");
    let installed_via_filter: Vec<_> = all.into_iter().filter(|r| r.installed).collect();

    assert_eq!(
        installed.len(),
        installed_via_filter.len(),
        "installed length mismatch"
    );
    for r in &installed {
        assert!(r.installed, "result {:?} has installed=false", r.key);
    }
    assert!(
        installed.iter().any(|r| r.key == "claude-code"),
        "claude-code should be installed in this fixture"
    );

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_unknown() {
    let err = check_harness("nonexistent-harness", CheckOptions::default())
        .expect_err("expected error for unknown harness");
    assert_eq!(err.to_string(), "Unknown harness: nonexistent-harness");
}

#[test]
fn test_check_harness_unresolved_placeholder() {
    let result = check_harness(
        "amazon-q-cli",
        CheckOptions {
            env: Some(env_home("/Users/test")),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    let data_root = find_path(&result, "data-root-env").expect("missing data-root-env");
    assert!(data_root.path.is_none(), "expected None path");
    assert!(!data_root.exists, "expected exists = false");
}

// ---------------------------------------------------------------------------
// Platform gating
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_platform_gated() {
    if cfg!(not(target_os = "macos")) {
        return; // darwin-only test
    }

    let result = check_harness(
        "cursor",
        CheckOptions {
            env: Some(env_home("/Users/test")),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    let app_macos = find_path(&result, "app-macos").expect("missing app-macos entry on darwin");
    assert_eq!(app_macos.path.as_deref(), Some("/Applications/Cursor.app"));
}

// ---------------------------------------------------------------------------
// Path match installs
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_path_match_installs() {
    let tmp = temp_dir();
    let claude_dir = tmp.join(".claude");
    fs::create_dir_all(&claude_dir).expect("mkdir");
    fs::write(claude_dir.join("settings.json"), "{}").expect("write file");

    let result = check_harness(
        "claude-code",
        CheckOptions {
            env: Some(env_home(tmp.to_str().unwrap())),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    assert!(result.installed, "expected installed");
    assert!(
        result.executable_path.is_none(),
        "expected no executable match"
    );
    assert!(!result.matched_paths.is_empty(), "expected matched paths");
    let settings = find_path(&result, "settings").expect("settings path should exist");
    assert!(settings.exists, "settings should exist");

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Executable match installs
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_executable_match_installs() {
    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    let exe_path = bin_dir.join("codex");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(&exe_path, "#!/bin/sh\nexit 0\n").expect("write file");
        fs::set_permissions(&exe_path, fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    #[cfg(windows)]
    {
        let exe_path = bin_dir.join("codex.exe");
        fs::write(&exe_path, "").expect("write file");
    }

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), "/Users/test".to_string());
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    assert!(result.installed, "expected installed from executable match");
    #[cfg(unix)]
    assert_eq!(
        result.executable_path.as_deref(),
        Some(exe_path.to_str().unwrap())
    );

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Non-executable does not match (unix only)
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_non_executable_does_not_match() {
    if cfg!(windows) {
        return; // unix-only test
    }

    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    let exe_path = bin_dir.join("codex");
    fs::write(&exe_path, "#!/bin/sh\nexit 0\n").expect("write file");
    // 0o644 — no executable bit.

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), tmp.to_string_lossy().into_owned());
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    assert!(
        !result.installed,
        "non-executable file should not count as installed"
    );
    assert!(
        result.executable_path.is_none(),
        "expected no executable match"
    );

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Reasons and matched paths
// ---------------------------------------------------------------------------

#[test]
fn test_check_harness_reasons_and_matched_paths() {
    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    let exe_path = bin_dir.join("codex");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(&exe_path, "#!/bin/sh\nexit 0\n").expect("write file");
        fs::set_permissions(&exe_path, fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    #[cfg(windows)]
    {
        let exe_path = bin_dir.join("codex.exe");
        fs::write(&exe_path, "").expect("write file");
    }

    let codex_home = tmp.join("codex-home");
    fs::create_dir_all(&codex_home).expect("mkdir");
    fs::write(codex_home.join("config.toml"), "").expect("write file");

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), tmp.to_string_lossy().into_owned());
    env.insert(
        "CODEX_HOME".to_string(),
        codex_home.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("unexpected error");

    assert!(result.installed, "expected installed");
    assert!(
        result.reasons.iter().any(|r| r == "executable:codex"),
        "missing executable reason, got {:?}",
        result.reasons
    );
    assert!(
        result.reasons.iter().any(|r| r == "config:config"),
        "missing config reason, got {:?}",
        result.reasons
    );

    let config = find_path(&result, "config").expect("config path should be matched");
    assert!(config.exists, "config path should be matched");
    #[cfg(unix)]
    {
        let want = codex_home.join("config.toml");
        assert_eq!(config.path.as_deref(), Some(want.to_str().unwrap()));
    }

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Windows executable tests
// ---------------------------------------------------------------------------

#[test]
fn test_find_executable_windows_exe() {
    if cfg!(not(target_os = "windows")) {
        return;
    }
    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    let exe_path = bin_dir.join("codex.exe");
    fs::write(&exe_path, "").expect("write file");

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), "/Users/test".to_string());
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());
    env.insert("PATHEXT".to_string(), ".EXE;.CMD;.BAT;.COM".to_string());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("check");

    assert!(result.installed, "expected installed from .exe match");
    assert_eq!(
        result.executable_path.as_deref(),
        Some(exe_path.to_str().unwrap())
    );

    cleanup(&tmp);
}

#[test]
fn test_find_executable_windows_bat() {
    if cfg!(not(target_os = "windows")) {
        return;
    }
    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    let bat_path = bin_dir.join("codex.bat");
    fs::write(&bat_path, "").expect("write file");

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), "/Users/test".to_string());
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());
    env.insert("PATHEXT".to_string(), ".EXE;.CMD;.BAT;.COM".to_string());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("check");

    assert!(result.installed, "expected installed from .bat match");
    assert_eq!(
        result.executable_path.as_deref(),
        Some(bat_path.to_str().unwrap())
    );

    cleanup(&tmp);
}

#[test]
fn test_find_executable_windows_no_match() {
    if cfg!(not(target_os = "windows")) {
        return;
    }
    let tmp = temp_dir();
    let bin_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dir).expect("mkdir");
    fs::write(bin_dir.join("codex"), "").expect("write file");

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), "/Users/test".to_string());
    env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());
    env.insert("PATHEXT".to_string(), ".EXE".to_string());

    let result = check_harness(
        "codex",
        CheckOptions {
            env: Some(env),
            cwd: Some("/repo".to_string()),
        },
    )
    .expect("check");

    assert!(
        !result.installed,
        "expected not installed when no PATHEXT match"
    );
    assert!(
        result.executable_path.is_none(),
        "expected no executable match"
    );

    cleanup(&tmp);
}

// ---------------------------------------------------------------------------
// Registry schema validation (basic, mirrors the Go test)
// ---------------------------------------------------------------------------

#[test]
fn test_registry_validates_against_schema() {
    use serde_json::Value;

    let shared_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
        .join("harnesses.json");
    let schema_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
        .join("harnesses.schema.json");
    let raw: Value =
        serde_json::from_str(&fs::read_to_string(&shared_path).expect("read canonical"))
            .expect("parse canonical");
    let schema: Value =
        serde_json::from_str(&fs::read_to_string(&schema_path).expect("read schema"))
            .expect("parse schema");

    for def_name in [
        "HarnessSupport",
        "HarnessSupportArea",
        "HarnessSupportScope",
        "HarnessSupportPath",
    ] {
        assert!(
            schema
                .get("$defs")
                .and_then(|defs| defs.get(def_name))
                .is_some(),
            "schema must define $defs.{def_name}"
        );
    }

    let version = raw
        .get("version")
        .and_then(Value::as_u64)
        .expect("version must be an integer");
    assert_eq!(version, 1, "version = {version}, want 1");
    let harnesses = raw
        .get("harnesses")
        .and_then(Value::as_array)
        .expect("harnesses must be an array");
    assert!(
        harnesses.len() >= 10,
        "harnesses length = {}, want >= 10",
        harnesses.len()
    );

    let mut seen: HashMap<String, bool> = HashMap::new();
    let allowed_platforms = [
        "aix", "android", "cygwin", "darwin", "freebsd", "haiku", "linux", "netbsd", "openbsd",
        "sunos", "win32",
    ];

    for h in harnesses {
        let h = h.as_object().expect("harness must be an object");
        let key = h
            .get("key")
            .and_then(Value::as_str)
            .expect("key must be a string");
        assert!(!seen.get(key).unwrap_or(&false), "duplicate key: {}", key);
        seen.insert(key.to_string(), true);

        assert!(
            is_valid_key(key),
            "key {:?} does not match ^[a-z][a-z0-9-]*$",
            key
        );
        assert!(
            h.get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| !name.is_empty()),
            "name is empty for key {}",
            key
        );
        assert!(
            h.get("aliases").and_then(Value::as_array).is_some(),
            "aliases must be a list for key {}",
            key
        );
        assert!(
            h.get("executables").and_then(Value::as_array).is_some(),
            "executables must be a list for key {}",
            key
        );
        assert!(
            h.get("paths").and_then(Value::as_array).is_some(),
            "paths must be a list for key {}",
            key
        );
        assert!(
            h.get("env").and_then(Value::as_array).is_some(),
            "env must be a list for key {}",
            key
        );

        let sources = h
            .get("sources")
            .and_then(Value::as_array)
            .expect("sources must be an array");
        assert!(
            !sources.is_empty(),
            "sources must be non-empty for key {}",
            key
        );
        for s in sources {
            let s = s.as_str().expect("source must be a string");
            assert!(
                s.starts_with("https://"),
                "source must be an https URL for key {}: {}",
                key,
                s
            );
        }

        let support = h.get("support").expect("support must be present");
        validate_support_object(key, support, &allowed_platforms);

        let paths = h
            .get("paths")
            .and_then(Value::as_array)
            .expect("paths must be an array");
        for p in paths {
            let p = p.as_object().expect("path must be an object");
            let id = p.get("id").and_then(Value::as_str).unwrap_or_default();
            assert!(!id.is_empty(), "path id must be non-empty for key {}", key);
            let category = p
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                ["install", "config", "state", "cache", "project"].contains(&category),
                "path category {:?} invalid for key {}",
                category,
                key
            );
            let kind = p.get("kind").and_then(Value::as_str).unwrap_or_default();
            assert!(
                ["file", "dir"].contains(&kind),
                "path kind {:?} invalid for key {}",
                kind,
                key
            );
            let template = p
                .get("template")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                validate_template(template),
                "path template {:?} invalid for key {}",
                template,
                key
            );
            for pl in p
                .get("platforms")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let pl = pl.as_str().expect("platform must be a string");
                assert!(
                    allowed_platforms.contains(&pl),
                    "unsupported path platform {:?} for key {}",
                    pl,
                    key
                );
            }
        }

        for e in h
            .get("env")
            .and_then(Value::as_array)
            .expect("env must be an array")
        {
            let e = e.as_object().expect("env entry must be an object");
            assert!(
                e.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| !name.is_empty()),
                "env name must be non-empty for key {}",
                key
            );
            assert!(
                e.get("description")
                    .and_then(Value::as_str)
                    .is_some_and(|description| !description.is_empty()),
                "env description must be non-empty for key {}",
                key
            );
        }

        for r in h
            .get("roots")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let r = r.as_object().expect("root must be an object");
            let root_name = r.get("name").and_then(Value::as_str).unwrap_or_default();
            assert!(
                is_valid_root_name(root_name),
                "root.name {:?} must match ^[A-Z][A-Z0-9_]*$ for key {}",
                root_name,
                key
            );
            if let Some(env_name) = r.get("env").and_then(Value::as_str) {
                assert!(
                    !env_name.is_empty(),
                    "root env must be non-empty for key {}",
                    key
                );
            }
            if let Some(use_value) = r.get("use").and_then(Value::as_str) {
                assert!(
                    validate_template(use_value),
                    "root.use {:?} invalid for key {}",
                    use_value,
                    key
                );
            }
            let fallback = r
                .get("fallback")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                validate_template(fallback),
                "root.fallback {:?} invalid for key {}",
                fallback,
                key
            );
        }

        let installations = h
            .get("installations")
            .and_then(Value::as_array)
            .expect("installations must be an array");
        assert!(
            !installations.is_empty(),
            "installations must be non-empty for key {}",
            key
        );
        for installation in installations {
            let installation = installation
                .as_object()
                .expect("installation must be an object");
            let method = installation
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                [
                    "npm",
                    "homebrew",
                    "pip",
                    "pipx",
                    "uv",
                    "cargo",
                    "go",
                    "script",
                    "manual",
                    "marketplace",
                    "binary",
                    "unknown"
                ]
                .contains(&method),
                "unsupported install method {:?} for key {}",
                method,
                key
            );
            let url = installation
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                url.starts_with("https://"),
                "installation url must be https for key {}",
                key
            );
            if let Some(pkg) = installation.get("package").and_then(Value::as_str) {
                assert!(
                    !pkg.is_empty(),
                    "installation package must be non-empty for key {}",
                    key
                );
            }
            if let Some(command) = installation.get("command").and_then(Value::as_str) {
                assert!(
                    !command.is_empty(),
                    "installation command must be non-empty for key {}",
                    key
                );
            }
            if let Some(notes) = installation.get("notes").and_then(Value::as_str) {
                assert!(
                    !notes.is_empty(),
                    "installation notes must be non-empty for key {}",
                    key
                );
            }
            for platform in installation
                .get("platforms")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let platform = platform
                    .as_str()
                    .expect("installation platform must be a string");
                assert!(
                    allowed_platforms.contains(&platform),
                    "unsupported installation platform {:?} for key {}",
                    platform,
                    key
                );
            }
        }
    }
}

fn validate_support_object(key: &str, support: &serde_json::Value, allowed_platforms: &[&str]) {
    use serde_json::Value;

    let support = support.as_object().expect("support must be an object");
    for area in ["config", "skills", "commands", "agents", "dotAgents"] {
        let area_value = support.get(area).unwrap_or_else(|| {
            panic!("support.{area} is required when support is present for key {key}")
        });
        let area_value = area_value
            .as_object()
            .unwrap_or_else(|| panic!("support.{area} must be an object for key {key}"));

        for scope in ["global", "local"] {
            let leaf = area_value
                .get(scope)
                .unwrap_or_else(|| panic!("support.{area}.{scope} is required for key {key}"));
            let leaf = leaf.as_object().unwrap_or_else(|| {
                panic!("support.{area}.{scope} must be an object for key {key}")
            });

            let status = leaf
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                ["supported", "unsupported", "unknown"].contains(&status),
                "unsupported support status {:?} for key {} area {} scope {}",
                status,
                key,
                area,
                scope
            );
            let confidence = leaf
                .get("confidence")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                ["official", "source", "observed", "inferred", "unknown"].contains(&confidence),
                "unsupported support confidence {:?} for key {} area {} scope {}",
                confidence,
                key,
                area,
                scope
            );

            let sources = leaf
                .get("sources")
                .and_then(Value::as_array)
                .unwrap_or_else(|| {
                    panic!("support.{area}.{scope}.sources must be an array for key {key}")
                });
            for source in sources {
                let source = source.as_str().expect("support source must be a string");
                assert!(
                    source.starts_with("https://"),
                    "support source must be an https URL for key {} area {} scope {}: {}",
                    key,
                    area,
                    scope,
                    source
                );
            }

            let paths = leaf
                .get("paths")
                .and_then(Value::as_array)
                .unwrap_or_else(|| {
                    panic!("support.{area}.{scope}.paths must be an array for key {key}")
                });
            for path in paths {
                let path = path.as_object().expect("support path must be an object");
                let id = path.get("id").and_then(Value::as_str).unwrap_or_default();
                assert!(
                    !id.is_empty(),
                    "support path id must be non-empty for key {} area {} scope {}",
                    key,
                    area,
                    scope
                );
                let kind = path.get("kind").and_then(Value::as_str).unwrap_or_default();
                assert!(
                    ["file", "dir"].contains(&kind),
                    "support path kind {:?} invalid for key {} area {} scope {}",
                    kind,
                    key,
                    area,
                    scope
                );
                let template = path
                    .get("template")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                assert!(
                    validate_template(template),
                    "support path template {:?} invalid for key {} area {} scope {}",
                    template,
                    key,
                    area,
                    scope
                );
                for platform in path
                    .get("platforms")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let platform = platform
                        .as_str()
                        .expect("support path platform must be a string");
                    assert!(
                        allowed_platforms.contains(&platform),
                        "unsupported support path platform {:?} for key {} area {} scope {}",
                        platform,
                        key,
                        area,
                        scope
                    );
                }
            }
        }
    }
}

fn is_valid_key(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_root_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Checks that every `${...}` in the template contains a valid uppercase
/// identifier.
fn validate_template(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            let rest = &s[i + 2..];
            match rest.find('}') {
                Some(end) => {
                    let inner = &rest[..end];
                    if !is_valid_root_name(inner) {
                        return false;
                    }
                    i = i + 2 + end + 1;
                }
                None => return false, // unclosed ${
            }
        } else {
            i += 1;
        }
    }
    true
}
