use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use harness_detect::{detect_harnesses, list_harnesses, CheckOptions};

fn main() {
    if let Err(error) = run() {
        eprintln!("perf_smoke: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let iterations = read_iterations()?;
    let harness_count = list_harnesses().len();
    let root_dir = create_temp_root()?;
    let result = (|| {
        let options = build_options(&root_dir)?;
        let warmup = detect_harnesses(options.clone()).map_err(|error| error.to_string())?;
        if warmup.len() != harness_count {
            return Err(format!(
                "warmup detect count mismatch: got {}, want {harness_count}",
                warmup.len()
            ));
        }

        let started_at = Instant::now();
        for index in 0..iterations {
            let results = detect_harnesses(options.clone()).map_err(|error| error.to_string())?;
            if results.len() != harness_count {
                return Err(format!(
                    "detect count mismatch on iteration {}: got {}, want {harness_count}",
                    index + 1,
                    results.len()
                ));
            }
        }
        let elapsed = started_at.elapsed();
        let elapsed_ms = elapsed.as_secs_f64() * 1000.0;
        let ops_per_sec = iterations as f64 / elapsed.as_secs_f64();

        println!(
            "rust perf: {iterations} iterations, {ops_per_sec:.2} ops/sec, {elapsed_ms:.2} ms elapsed, {harness_count} harnesses/run, PATH=empty, hermetic env"
        );
        Ok(())
    })();
    let _ = fs::remove_dir_all(&root_dir);
    result
}

fn read_iterations() -> Result<usize, String> {
    let Some(raw) = std::env::var("HARNESS_DETECT_PERF_ITERATIONS").ok() else {
        return Ok(250);
    };
    let parsed = raw.parse::<usize>().map_err(|_| {
        format!("HARNESS_DETECT_PERF_ITERATIONS must be a positive integer, got {raw}")
    })?;
    if parsed == 0 {
        return Err(format!(
            "HARNESS_DETECT_PERF_ITERATIONS must be a positive integer, got {raw}"
        ));
    }
    Ok(parsed)
}

fn create_temp_root() -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!(
        "harness-detect-perf-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&root).map_err(|error| format!("create {}: {error}", root.display()))?;
    Ok(root)
}

fn build_options(root_dir: &Path) -> Result<CheckOptions, String> {
    let home = root_dir.join("home");
    let cwd = root_dir.join("cwd");

    for dir in [
        home.clone(),
        cwd.clone(),
        home.join(".config"),
        home.join(".local").join("share"),
        home.join(".local").join("state"),
        home.join(".cache"),
    ] {
        fs::create_dir_all(&dir).map_err(|error| format!("mkdir {}: {error}", dir.display()))?;
    }

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), path_to_string(&home));
    env.insert("PATH".to_string(), String::new());
    env.insert(
        "XDG_CONFIG_HOME".to_string(),
        path_to_string(&home.join(".config")),
    );
    env.insert(
        "XDG_DATA_HOME".to_string(),
        path_to_string(&home.join(".local").join("share")),
    );
    env.insert(
        "XDG_STATE_HOME".to_string(),
        path_to_string(&home.join(".local").join("state")),
    );
    env.insert(
        "XDG_CACHE_HOME".to_string(),
        path_to_string(&home.join(".cache")),
    );
    env.insert(
        "CODEX_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/codex")),
    );
    env.insert(
        "CLAUDE_CONFIG_DIR".to_string(),
        path_to_string(&root_dir.join("overrides/claude")),
    );
    env.insert(
        "GEMINI_CLI_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/gemini-home")),
    );
    env.insert(
        "OPENCODE_CONFIG_DIR".to_string(),
        path_to_string(&root_dir.join("overrides/opencode-config")),
    );
    env.insert(
        "GOOSE_PATH_ROOT".to_string(),
        path_to_string(&root_dir.join("overrides/goose")),
    );
    env.insert(
        "CLINE_DIR".to_string(),
        path_to_string(&root_dir.join("overrides/cline")),
    );
    env.insert(
        "Q_CLI_DATA_DIR".to_string(),
        path_to_string(&root_dir.join("overrides/amazon-q")),
    );
    env.insert(
        "COPILOT_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/copilot")),
    );
    env.insert(
        "COPILOT_CACHE_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/copilot-cache")),
    );
    env.insert(
        "AMP_DATA_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/amp-data")),
    );
    env.insert(
        "HERMES_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/hermes")),
    );
    env.insert(
        "OPENCLAW_HOME".to_string(),
        path_to_string(&root_dir.join("overrides/openclaw")),
    );
    env.insert(
        "OPENCLAW_STATE_DIR".to_string(),
        path_to_string(&root_dir.join("overrides/openclaw-state")),
    );
    env.insert(
        "AUTOGENSTUDIO_APPDIR".to_string(),
        path_to_string(&root_dir.join("overrides/autogenstudio")),
    );

    Ok(CheckOptions {
        cwd: Some(path_to_string(&cwd)),
        env: Some(env),
    })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
