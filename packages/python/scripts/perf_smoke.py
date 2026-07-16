from __future__ import annotations

import os
import shutil
import tempfile
import time

from harness_detect import CheckOptions, detect_harnesses, list_harnesses


def main() -> None:
    iterations = read_iterations()
    harness_count = len(list_harnesses())
    root_dir = tempfile.mkdtemp(prefix="harness-detect-perf-")
    try:
        options = build_options(root_dir)
        warmup = detect_harnesses(options)
        if len(warmup) != harness_count:
            raise RuntimeError(
                f"warmup detect count mismatch: got {len(warmup)}, want {harness_count}"
            )

        started_at = time.perf_counter()
        for index in range(iterations):
            results = detect_harnesses(options)
            if len(results) != harness_count:
                raise RuntimeError(
                    f"detect count mismatch on iteration {index + 1}: got {len(results)}, want {harness_count}"
                )
        elapsed = time.perf_counter() - started_at
        elapsed_ms = elapsed * 1000
        ops_per_sec = iterations / elapsed
        print(
            f"python perf: {iterations} iterations, {ops_per_sec:.2f} ops/sec, "
            f"{elapsed_ms:.2f} ms elapsed, {harness_count} harnesses/run, "
            "PATH=empty, hermetic env"
        )
    finally:
        shutil.rmtree(root_dir, ignore_errors=True)


def read_iterations() -> int:
    raw = os.environ.get("HARNESS_DETECT_PERF_ITERATIONS")
    if raw is None:
        return 250
    try:
        parsed = int(raw)
    except ValueError as error:
        raise ValueError(
            f"HARNESS_DETECT_PERF_ITERATIONS must be a positive integer, got {raw}"
        ) from error
    if parsed <= 0:
        raise ValueError(
            f"HARNESS_DETECT_PERF_ITERATIONS must be a positive integer, got {raw}"
        )
    return parsed


def build_options(root_dir: str) -> CheckOptions:
    home = os.path.join(root_dir, "home")
    cwd = os.path.join(root_dir, "cwd")
    for directory in (
        home,
        cwd,
        os.path.join(home, ".config"),
        os.path.join(home, ".local", "share"),
        os.path.join(home, ".local", "state"),
        os.path.join(home, ".cache"),
    ):
        os.makedirs(directory, exist_ok=True)

    env = {
        "HOME": home,
        "PATH": "",
        "XDG_CONFIG_HOME": os.path.join(home, ".config"),
        "XDG_DATA_HOME": os.path.join(home, ".local", "share"),
        "XDG_STATE_HOME": os.path.join(home, ".local", "state"),
        "XDG_CACHE_HOME": os.path.join(home, ".cache"),
        "CODEX_HOME": os.path.join(root_dir, "overrides", "codex"),
        "CLAUDE_CONFIG_DIR": os.path.join(root_dir, "overrides", "claude"),
        "GEMINI_CLI_HOME": os.path.join(root_dir, "overrides", "gemini-home"),
        "OPENCODE_CONFIG_DIR": os.path.join(root_dir, "overrides", "opencode-config"),
        "GOOSE_PATH_ROOT": os.path.join(root_dir, "overrides", "goose"),
        "CLINE_DIR": os.path.join(root_dir, "overrides", "cline"),
        "Q_CLI_DATA_DIR": os.path.join(root_dir, "overrides", "amazon-q"),
        "COPILOT_HOME": os.path.join(root_dir, "overrides", "copilot"),
        "COPILOT_CACHE_HOME": os.path.join(root_dir, "overrides", "copilot-cache"),
        "AMP_DATA_HOME": os.path.join(root_dir, "overrides", "amp-data"),
        "HERMES_HOME": os.path.join(root_dir, "overrides", "hermes"),
        "OPENCLAW_HOME": os.path.join(root_dir, "overrides", "openclaw"),
        "OPENCLAW_STATE_DIR": os.path.join(root_dir, "overrides", "openclaw-state"),
        "AUTOGENSTUDIO_APPDIR": os.path.join(root_dir, "overrides", "autogenstudio"),
    }
    return CheckOptions(env=env, cwd=cwd)


if __name__ == "__main__":
    main()
