use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use harness_detect::{
    check_harness, detect_harnesses, get_harness_support, list_harness_support, CheckOptions,
    HarnessCheckResult, HarnessSupport, HarnessSupportArea, HarnessSupportPath,
    HarnessSupportRecord, HarnessSupportScope,
};
use serde_json::{json, Value};

struct SandboxRoots {
    tmp: PathBuf,
    home: PathBuf,
    cwd: PathBuf,
    bin: PathBuf,
}

struct SetupEntry {
    kind: String,
    path: PathBuf,
    content: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("parity_snapshot: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let input = read_input()?;
    let parsed: Value = serde_json::from_str(&input).map_err(|error| error.to_string())?;
    let version = parsed.get("version").cloned().unwrap_or(Value::Null);
    let cases = parsed
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| "Parity input must be an object with a cases array.".to_string())?;

    let roots = create_sandbox()?;
    let result = (|| {
        let mut output_cases = Vec::with_capacity(cases.len());
        for case in cases {
            output_cases.push(run_case(case, &roots)?);
        }

        let output = json!({
            "version": version,
            "cases": output_cases,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).map_err(|error| error.to_string())?
        );
        Ok(())
    })();

    let _ = fs::remove_dir_all(&roots.tmp);
    result
}

fn read_input() -> Result<String, String> {
    if let Some(source) = std::env::args().nth(1).filter(|arg| arg != "-") {
        return fs::read_to_string(&source).map_err(|error| format!("read {source}: {error}"));
    }

    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("read stdin: {error}"))?;
    if input.trim().is_empty() {
        return Err("Expected JSON parity cases from stdin or a file path argument.".to_string());
    }
    Ok(input)
}

fn create_sandbox() -> Result<SandboxRoots, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!(
        "harness-detect-parity-{}-{nanos}",
        std::process::id()
    ));
    let roots = SandboxRoots {
        home: tmp.join("home"),
        cwd: tmp.join("cwd"),
        bin: tmp.join("bin"),
        tmp,
    };

    for dir in [&roots.tmp, &roots.home, &roots.cwd, &roots.bin] {
        fs::create_dir_all(dir).map_err(|error| format!("create {}: {error}", dir.display()))?;
    }

    Ok(roots)
}

fn run_case(raw_case: &Value, roots: &SandboxRoots) -> Result<Value, String> {
    let id = required_string(raw_case, "id")?;
    let operation = required_string(raw_case, "operation")?;
    let expanded_case = expand_value(raw_case, roots);

    if should_skip_platform(&expanded_case) {
        return Ok(json!({
            "id": id,
            "operation": operation,
            "skipped": true,
        }));
    }

    let env = value_to_env(expanded_case.get("env"));
    let cwd = expanded_case
        .get("cwd")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let setup = value_to_setup(expanded_case.get("setup"), roots)?;

    apply_setup(&setup)?;
    let result = (|| {
        let options = CheckOptions {
            env: Some(env),
            cwd,
        };
        let snapshot = match operation.as_str() {
            "checkHarness" => {
                let input = required_string(&expanded_case, "input")?;
                let result = check_harness(&input, options).map_err(|error| error.to_string())?;
                normalize_check_result(&result, roots)
            }
            "detectHarnesses" => {
                let results = detect_harnesses(options).map_err(|error| error.to_string())?;
                normalize_detect_results(&results, roots)
            }
            "getHarnessSupport" => {
                let input = required_string(&expanded_case, "input")?;
                let record = get_harness_support(&input).map_err(|error| error.to_string())?;
                normalize_support_record(&record)
            }
            "listHarnessSupport" => normalize_support_list(&list_harness_support()),
            other => return Err(format!("Unsupported parity operation: {other}")),
        };

        Ok(json!({
            "id": id,
            "operation": operation,
            "result": snapshot,
        }))
    })();
    cleanup_setup(&setup);
    result
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("missing string field {key}"))
}

fn expand_value(value: &Value, roots: &SandboxRoots) -> Value {
    match value {
        Value::String(raw) => Value::String(expand_string(raw, roots)),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| expand_value(item, roots)).collect())
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), expand_value(item, roots)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn expand_string(value: &str, roots: &SandboxRoots) -> String {
    value
        .replace("${TMP}", &path_to_string(&roots.tmp))
        .replace("${HOME}", &path_to_string(&roots.home))
        .replace("${CWD}", &path_to_string(&roots.cwd))
        .replace("${BIN}", &path_to_string(&roots.bin))
}

fn should_skip_platform(value: &Value) -> bool {
    value
        .get("platforms")
        .and_then(Value::as_array)
        .is_some_and(|platforms| {
            !platforms
                .iter()
                .filter_map(Value::as_str)
                .any(|platform| platform == current_platform())
        })
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        std::env::consts::OS
    }
}

fn value_to_env(value: Option<&Value>) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Some(object) = value.and_then(Value::as_object) {
        for (key, item) in object {
            if let Some(raw) = item.as_str() {
                env.insert(key.clone(), raw.to_string());
            }
        }
    }
    env
}

fn value_to_setup(value: Option<&Value>, roots: &SandboxRoots) -> Result<Vec<SetupEntry>, String> {
    let mut setup = Vec::new();
    for entry in value.and_then(Value::as_array).into_iter().flatten() {
        let kind = required_string(entry, "type")?;
        let raw_path = required_string(entry, "path")?;
        let path = resolve_sandbox_path(&raw_path, &roots.tmp)?;
        let content = entry
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        setup.push(SetupEntry {
            kind,
            path,
            content,
        });
    }
    Ok(setup)
}

fn resolve_sandbox_path(raw_path: &str, sandbox_root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw_path);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| format!("resolve current dir: {error}"))?
            .join(path)
    };
    if !absolute.starts_with(sandbox_root) {
        return Err(format!("Parity setup path escapes temp root: {raw_path}"));
    }
    Ok(absolute)
}

fn apply_setup(setup: &[SetupEntry]) -> Result<(), String> {
    for entry in setup {
        match entry.kind.as_str() {
            "dir" => fs::create_dir_all(&entry.path)
                .map_err(|error| format!("setup dir {}: {error}", entry.path.display()))?,
            "file" | "executable" => {
                if let Some(parent) = entry.path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("setup parent {}: {error}", parent.display()))?;
                }
                fs::write(&entry.path, &entry.content)
                    .map_err(|error| format!("setup file {}: {error}", entry.path.display()))?;
                #[cfg(unix)]
                if entry.kind == "executable" {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&entry.path, fs::Permissions::from_mode(0o755))
                        .map_err(|error| format!("chmod {}: {error}", entry.path.display()))?;
                }
            }
            other => return Err(format!("Unsupported parity setup type: {other}")),
        }
    }
    Ok(())
}

fn cleanup_setup(setup: &[SetupEntry]) {
    for entry in setup.iter().rev() {
        if entry.kind == "dir" {
            let _ = fs::remove_dir_all(&entry.path);
        } else {
            let _ = fs::remove_file(&entry.path);
        }
    }
}

fn normalize_check_result(result: &HarnessCheckResult, roots: &SandboxRoots) -> Value {
    let mut matched_path_ids: Vec<String> = result
        .matched_paths
        .iter()
        .map(|path| path.id.clone())
        .collect();
    matched_path_ids.sort();

    let mut paths: Vec<Value> = result
        .paths
        .iter()
        .map(|path| {
            json!({
                "id": &path.id,
                "path": normalize_path_value(path.path.as_deref(), roots),
                "exists": path.exists,
            })
        })
        .collect();
    paths.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));

    json!({
        "key": &result.key,
        "installed": result.installed,
        "executablePath": normalize_path_value(result.executable_path.as_deref(), roots),
        "matchedPathIds": matched_path_ids,
        "paths": paths,
    })
}

fn normalize_detect_results(results: &[HarnessCheckResult], roots: &SandboxRoots) -> Value {
    let mut normalized_results: Vec<Value> = results
        .iter()
        .map(|result| normalize_check_result(result, roots))
        .collect();
    normalized_results.sort_by(|left, right| left["key"].as_str().cmp(&right["key"].as_str()));

    let mut installed_keys: Vec<String> = normalized_results
        .iter()
        .filter(|result| result["installed"].as_bool().unwrap_or(false))
        .filter_map(|result| result["key"].as_str().map(ToOwned::to_owned))
        .collect();
    installed_keys.sort();

    json!({
        "count": results.len(),
        "installedCount": installed_keys.len(),
        "installedKeys": installed_keys,
        "results": normalized_results,
    })
}

fn normalize_path_value(value: Option<&str>, roots: &SandboxRoots) -> Value {
    let Some(raw) = value else {
        return Value::Null;
    };

    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = path_to_string(&absolute);

    let mut replacements = vec![
        ("${TMP}", path_to_string(&roots.tmp)),
        ("${HOME}", path_to_string(&roots.home)),
        ("${CWD}", path_to_string(&roots.cwd)),
        ("${BIN}", path_to_string(&roots.bin)),
    ];
    replacements.sort_by_key(|entry| std::cmp::Reverse(entry.1.len()));
    for (placeholder, root) in replacements {
        if normalized == root {
            normalized = placeholder.to_string();
            break;
        }
        let prefix = format!("{}{}", root, std::path::MAIN_SEPARATOR);
        if normalized.starts_with(&prefix) {
            normalized = format!("{}{}", placeholder, &normalized[root.len()..]);
            break;
        }
    }

    Value::String(normalized)
}

fn normalize_support_path(path: &HarnessSupportPath) -> Value {
    let mut platforms = path.platforms.clone();
    platforms.sort();
    json!({
        "id": &path.id,
        "kind": &path.kind,
        "template": &path.template,
        "platforms": if platforms.is_empty() { Value::Null } else { json!(platforms) },
        "description": if path.description.is_empty() { Value::Null } else { json!(&path.description) },
    })
}

fn normalize_support_leaf(leaf: &HarnessSupportScope) -> Value {
    let mut sources = leaf.sources.clone();
    sources.sort();
    let mut paths: Vec<Value> = leaf.paths.iter().map(normalize_support_path).collect();
    paths.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    json!({
        "status": &leaf.status,
        "confidence": &leaf.confidence,
        "notes": if leaf.notes.is_empty() { Value::Null } else { json!(&leaf.notes) },
        "sources": sources,
        "paths": paths,
    })
}

fn normalize_support_area(area: &HarnessSupportArea) -> Value {
    json!({
        "global": normalize_support_leaf(&area.global),
        "local": normalize_support_leaf(&area.local),
    })
}

fn normalize_support(support: &HarnessSupport) -> Value {
    json!({
        "config": normalize_support_area(&support.config),
        "skills": normalize_support_area(&support.skills),
        "commands": normalize_support_area(&support.commands),
        "agents": normalize_support_area(&support.agents),
        "dotAgents": normalize_support_area(&support.dot_agents),
    })
}

fn normalize_support_record(record: &HarnessSupportRecord) -> Value {
    json!({
        "key": &record.key,
        "name": &record.name,
        "support": normalize_support(&record.support),
    })
}

fn normalize_support_list(records: &[HarnessSupportRecord]) -> Value {
    let mut normalized_records: Vec<Value> = records.iter().map(normalize_support_record).collect();
    normalized_records.sort_by(|left, right| left["key"].as_str().cmp(&right["key"].as_str()));
    json!({
        "count": normalized_records.len(),
        "records": normalized_records,
    })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
