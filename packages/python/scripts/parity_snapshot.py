from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any

from harness_detect import (
    CheckOptions,
    HarnessCheckResult,
    HarnessSupport,
    HarnessSupportArea,
    HarnessSupportPath,
    HarnessSupportRecord,
    HarnessSupportScope,
    check_harness,
    detect_harnesses,
    get_harness_support,
    list_harness_support,
)


def main() -> None:
    try:
        run()
    except Exception as error:  # noqa: BLE001 - CLI helper should print concise errors.
        print(f"parity_snapshot: {error}", file=sys.stderr)
        raise SystemExit(1) from error


def run() -> None:
    parsed = json.loads(read_input())
    cases = parsed.get("cases")
    if not isinstance(cases, list):
        raise ValueError("Parity input must be an object with a cases array.")

    roots = create_sandbox()
    try:
        output = {
            "version": parsed.get("version"),
            "cases": [run_case(case, roots) for case in cases],
        }
        print(json.dumps(output, indent=2))
    finally:
        shutil.rmtree(roots["TMP"], ignore_errors=True)


def read_input() -> str:
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        return Path(sys.argv[1]).read_text(encoding="utf-8")

    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError(
            "Expected JSON parity cases from stdin or a file path argument."
        )
    return raw


def create_sandbox() -> dict[str, str]:
    temp_root = tempfile.mkdtemp(prefix="harness-detect-parity-")
    roots = {
        "TMP": temp_root,
        "HOME": os.path.join(temp_root, "home"),
        "CWD": os.path.join(temp_root, "cwd"),
        "BIN": os.path.join(temp_root, "bin"),
    }
    for path in roots.values():
        os.makedirs(path, exist_ok=True)
    return roots


def run_case(raw_case: dict[str, Any], roots: dict[str, str]) -> dict[str, Any]:
    case = expand_value(raw_case, roots)
    if should_skip_platform(case):
        return {"id": case["id"], "operation": case["operation"], "skipped": True}

    setup = prepare_setup(case.get("setup", []), roots["TMP"])
    apply_setup(setup)
    try:
        options = CheckOptions(env=dict(case.get("env", {})), cwd=case.get("cwd"))
        operation = case["operation"]
        if operation == "checkHarness":
            result = normalize_check_result(
                check_harness(case["input"], options), roots
            )
        elif operation == "detectHarnesses":
            result = normalize_detect_results(detect_harnesses(options), roots)
        elif operation == "getHarnessSupport":
            result = normalize_support_record(get_harness_support(case["input"]))
        elif operation == "listHarnessSupport":
            result = normalize_support_list(list_harness_support())
        else:
            raise ValueError(f"Unsupported parity operation: {operation}")

        return {"id": case["id"], "operation": operation, "result": result}
    finally:
        cleanup_setup(setup)


def expand_value(value: Any, roots: dict[str, str]) -> Any:
    if isinstance(value, str):
        return expand_string(value, roots)
    if isinstance(value, list):
        return [expand_value(item, roots) for item in value]
    if isinstance(value, dict):
        return {key: expand_value(item, roots) for key, item in value.items()}
    return value


def expand_string(value: str, roots: dict[str, str]) -> str:
    for key, root in roots.items():
        value = value.replace("${" + key + "}", root)
    return value


def should_skip_platform(case: dict[str, Any]) -> bool:
    platforms = case.get("platforms")
    return isinstance(platforms, list) and current_platform() not in platforms


def current_platform() -> str:
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform == "win32":
        return "win32"
    return sys.platform


def prepare_setup(
    setup: list[dict[str, Any]], sandbox_root: str
) -> list[dict[str, str]]:
    return [
        {
            "type": entry["type"],
            "path": resolve_sandbox_path(entry["path"], sandbox_root),
            "content": entry.get("content", ""),
        }
        for entry in setup
    ]


def resolve_sandbox_path(target_path: str, sandbox_root: str) -> str:
    absolute = os.path.abspath(target_path)
    sandbox = os.path.abspath(sandbox_root)
    if os.path.commonpath([sandbox, absolute]) != sandbox:
        raise ValueError(f"Parity setup path escapes temp root: {target_path}")
    return absolute


def apply_setup(setup: list[dict[str, str]]) -> None:
    for entry in setup:
        path = entry["path"]
        if entry["type"] == "dir":
            os.makedirs(path, exist_ok=True)
        elif entry["type"] in {"file", "executable"}:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            Path(path).write_text(entry["content"], encoding="utf-8")
            if entry["type"] == "executable" and sys.platform != "win32":
                os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        else:
            raise ValueError(f"Unsupported parity setup type: {entry['type']}")


def cleanup_setup(setup: list[dict[str, str]]) -> None:
    for entry in reversed(setup):
        path = entry["path"]
        if not os.path.exists(path):
            continue
        if entry["type"] == "dir":
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass


def normalize_check_result(
    result: HarnessCheckResult, roots: dict[str, str]
) -> dict[str, Any]:
    return {
        "key": result.key,
        "installed": bool(result.installed),
        "executablePath": normalize_path_value(result.executable_path, roots),
        "matchedPathIds": sorted(path.id for path in result.matched_paths),
        "paths": sorted(
            (
                {
                    "id": path.id,
                    "path": normalize_path_value(path.path, roots),
                    "exists": bool(path.exists),
                }
                for path in result.paths
            ),
            key=lambda path: path["id"],
        ),
    }


def normalize_detect_results(
    results: list[HarnessCheckResult], roots: dict[str, str]
) -> dict[str, Any]:
    normalized_results = sorted(
        (normalize_check_result(result, roots) for result in results),
        key=lambda result: result["key"],
    )
    installed_keys = sorted(
        result["key"] for result in normalized_results if result["installed"]
    )
    return {
        "count": len(results),
        "installedCount": len(installed_keys),
        "installedKeys": installed_keys,
        "results": normalized_results,
    }


def normalize_path_value(value: str | None, roots: dict[str, str]) -> str | None:
    if value is None:
        return None

    normalized = os.path.abspath(value)
    replacements = sorted(
        (("${" + key + "}", os.path.abspath(root)) for key, root in roots.items()),
        key=lambda item: len(item[1]),
        reverse=True,
    )
    for placeholder, root in replacements:
        if normalized == root:
            return placeholder
        prefix = root + os.sep
        if normalized.startswith(prefix):
            return placeholder + normalized[len(root) :]
    return normalized


def normalize_support_path(path: HarnessSupportPath) -> dict[str, Any]:
    return {
        "id": path.id,
        "kind": path.kind,
        "template": path.template,
        "platforms": sorted(path.platforms) if path.platforms else None,
        "description": path.description or None,
    }


def normalize_support_leaf(leaf: HarnessSupportScope) -> dict[str, Any]:
    return {
        "status": leaf.status,
        "confidence": leaf.confidence,
        "notes": leaf.notes or None,
        "sources": sorted(leaf.sources),
        "paths": sorted(
            (normalize_support_path(path) for path in leaf.paths),
            key=lambda path: path["id"],
        ),
    }


def normalize_support_area(area: HarnessSupportArea) -> dict[str, Any]:
    return {
        "global": normalize_support_leaf(area.global_),
        "local": normalize_support_leaf(area.local),
    }


def normalize_support(support: HarnessSupport) -> dict[str, Any]:
    return {
        "config": normalize_support_area(support.config),
        "skills": normalize_support_area(support.skills),
        "commands": normalize_support_area(support.commands),
        "agents": normalize_support_area(support.agents),
        "dotAgents": normalize_support_area(support.dot_agents),
    }


def normalize_support_record(record: HarnessSupportRecord) -> dict[str, Any]:
    return {
        "key": record.key,
        "name": record.name,
        "support": normalize_support(record.support),
    }


def normalize_support_list(records: list[HarnessSupportRecord]) -> dict[str, Any]:
    normalized_records = sorted(
        (normalize_support_record(record) for record in records),
        key=lambda record: record["key"],
    )
    return {"count": len(normalized_records), "records": normalized_records}


if __name__ == "__main__":
    main()
