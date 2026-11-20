//! Changes the process working directory, so it lives in its own test binary.
#![cfg(unix)]

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;

use harness_detect::{detect_installed_acp_launches, CheckOptions};

#[test]
fn relative_path_entries_are_ignored() {
    let root = fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("harness-detect-acp-{}", std::process::id()));
    for dir in ["relative-bin", "absolute-bin"] {
        fs::create_dir_all(root.join(dir)).unwrap();
        let binary = root.join(dir).join("gemini");
        fs::write(&binary, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::env::set_current_dir(&root).unwrap();

    let options = |path: String| CheckOptions {
        env: Some(HashMap::from([
            ("HOME".to_string(), root.to_string_lossy().into_owned()),
            ("PATH".to_string(), path),
        ])),
        cwd: None,
    };

    assert!(detect_installed_acp_launches(options("relative-bin".into())).is_empty());

    let absolute = root.join("absolute-bin");
    let both =
        detect_installed_acp_launches(options(format!("relative-bin:{}", absolute.display())));
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].key, "gemini-cli");
    assert_eq!(
        both[0].command,
        absolute.join("gemini").to_string_lossy().as_ref()
    );
    assert_eq!(both[0].args, ["--acp"]);

    let _ = fs::remove_dir_all(&root);
}
