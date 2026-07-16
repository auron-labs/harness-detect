"""Behavior tests mirroring the TypeScript, Go, and Rust packages.

These tests exercise the public API only.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import sys
import tempfile
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

import harness_detect
from harness_detect import (
    CheckOptions,
    HarnessCheckResult,
    HarnessError,
    HarnessSupportRecord,
    ResolvedHarnessPath,
    check_harness,
    detect_harnesses,
    detect_installed_harnesses,
    get_harness_matrix,
    get_harness_support,
    list_harnesses,
    list_harness_support,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_path(result: HarnessCheckResult, id: str) -> ResolvedHarnessPath | None:
    for p in result.paths:
        if p.id == id:
            return p
    return None


def _find_support_record(
    records: list[HarnessSupportRecord], key: str
) -> HarnessSupportRecord | None:
    for record in records:
        if record.key == key:
            return record
    return None


def _env_home(home: str) -> dict[str, str]:
    return {"HOME": home, "PATH": ""}


@pytest.fixture
def tmp():
    d = tempfile.mkdtemp(prefix="harness-detect-")
    yield Path(d)
    shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------------------
# Registry sync
# ---------------------------------------------------------------------------


def test_bundled_data_matches_shared_file():
    """The bundled harnesses.json must match packages/data/harnesses.json
    byte-for-byte."""
    import importlib.resources

    bundled = (
        importlib.resources.files("harness_detect.data")
        .joinpath("harnesses.json")
        .read_text(encoding="utf-8")
    )
    shared = (
        Path(__file__).resolve().parents[2] / "data" / "harnesses.json"
    ).read_text(encoding="utf-8")
    assert bundled == shared, (
        "packages/python/src/harness_detect/data/harnesses.json must match "
        "packages/data/harnesses.json byte-for-byte; refresh the bundled copy."
    )


# ---------------------------------------------------------------------------
# Matrix readability
# ---------------------------------------------------------------------------


def test_get_harness_matrix():
    matrix = get_harness_matrix()
    assert matrix.version == 1
    assert len(matrix.harnesses) >= 10


def test_list_harnesses():
    matrix = get_harness_matrix()
    harnesses = list_harnesses()
    assert len(harnesses) == len(matrix.harnesses)


def test_support_api_matches_matrix_shape():
    matrix = get_harness_matrix()
    support_list = list_harness_support()

    assert len(support_list) == len(matrix.harnesses)

    for harness in matrix.harnesses:
        record = _find_support_record(support_list, harness.key)
        assert record is not None
        assert record.name == harness.name
        assert record.support == harness.support

        support = get_harness_support(harness.key)
        assert support == HarnessSupportRecord(
            key=harness.key,
            name=harness.name,
            support=harness.support,
        )


def test_support_api_is_immutable():
    record = get_harness_support("codex")

    with pytest.raises(FrozenInstanceError):
        setattr(record, "name", "mutated")

    with pytest.raises(FrozenInstanceError):
        setattr(record.support.config.global_, "status", "mutated")

    with pytest.raises(AttributeError):
        getattr(record.support.commands.local.sources, "append")(
            "https://example.com/mutated"
        )

    refreshed = get_harness_support("codex")
    assert refreshed == record


def test_harness_definition_exposes_support_and_installations():
    codex = next(h for h in list_harnesses() if h.key == "codex")

    assert codex.installations
    assert codex.installations[0].method
    assert codex.support.config.global_.status in {
        "supported",
        "unsupported",
        "unknown",
    }
    assert isinstance(codex.support.config.global_.paths, tuple)
    assert isinstance(codex.support.commands.local.sources, tuple)


# ---------------------------------------------------------------------------
# Env override resolution
# ---------------------------------------------------------------------------


def test_check_harness_resolves_env_overrides():
    env = _env_home("/Users/test")
    env["CODEX_HOME"] = "/tmp/codex-home"

    result = check_harness(
        "codex",
        CheckOptions(env=env, cwd="/repo"),
    )

    config = _find_path(result, "config")
    project = _find_path(result, "project-config")
    assert config is not None
    assert project is not None
    assert config.path == os.path.normpath("/tmp/codex-home/config.toml")
    assert project.path == os.path.normpath("/repo/.codex/config.toml")


def test_check_harness_ignores_env_cwd_when_option_unset():
    env = _env_home("/Users/test")
    env["CWD"] = "/wrong"

    result = check_harness("codex", CheckOptions(env=env))

    project = _find_path(result, "project-config")
    assert project is not None
    want = os.path.normpath(os.path.join(os.getcwd(), ".codex", "config.toml"))
    assert project.path == want


def test_check_harness_resolves_derived_roots():
    env = _env_home("/Users/test")
    env["HERMES_HOME"] = "/tmp/hermes-home"

    result = check_harness(
        "hermes-agent",
        CheckOptions(env=env, cwd="/repo"),
    )

    config = _find_path(result, "config")
    sessions = _find_path(result, "sessions")
    assert config is not None
    assert sessions is not None
    assert config.path == os.path.normpath("/tmp/hermes-home/config.yaml")
    assert sessions.path == os.path.normpath("/tmp/hermes-home/sessions")


# ---------------------------------------------------------------------------
# Alias lookup
# ---------------------------------------------------------------------------


def test_check_harness_aliases_match():
    opts = CheckOptions(env=_env_home("/Users/test"), cwd="/repo")
    by_key = check_harness("claude-code", opts)
    by_alias = check_harness("claude", opts)
    assert by_key.key == by_alias.key


# ---------------------------------------------------------------------------
# Full-registry iteration
# ---------------------------------------------------------------------------


def test_detect_harnesses_checks_all():
    all_results = detect_harnesses(
        CheckOptions(env=_env_home("/Users/test"), cwd="/repo")
    )
    assert len(all_results) == len(list_harnesses())


def test_detect_installed_harnesses_only_installed(tmp):
    claude_dir = tmp / ".claude"
    claude_dir.mkdir(parents=True)
    (claude_dir / "settings.json").write_text("{}")

    opts = CheckOptions(env=_env_home(str(tmp)), cwd="/repo")
    installed = detect_installed_harnesses(opts)
    all_results = detect_harnesses(opts)
    installed_via_filter = [r for r in all_results if r.installed]

    assert len(installed) == len(installed_via_filter)
    assert all(r.installed for r in installed)
    assert any(r.key == "claude-code" for r in installed)


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def test_check_harness_unknown():
    with pytest.raises(HarnessError) as exc:
        check_harness("nonexistent-harness", CheckOptions())
    assert str(exc.value) == "Unknown harness: nonexistent-harness"


def test_get_harness_support_unknown():
    with pytest.raises(HarnessError) as exc:
        get_harness_support("nonexistent-harness")
    assert str(exc.value) == "Unknown harness: nonexistent-harness"


def test_check_harness_unresolved_placeholder():
    result = check_harness(
        "amazon-q-cli",
        CheckOptions(env=_env_home("/Users/test"), cwd="/repo"),
    )
    data_root = _find_path(result, "data-root-env")
    assert data_root is not None
    assert data_root.path is None
    assert data_root.exists is False


# ---------------------------------------------------------------------------
# Platform gating
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform != "darwin", reason="darwin-only test")
def test_check_harness_platform_gated():
    result = check_harness(
        "cursor",
        CheckOptions(env=_env_home("/Users/test"), cwd="/repo"),
    )
    app_macos = _find_path(result, "app-macos")
    assert app_macos is not None
    assert app_macos.path == os.path.normpath("/Applications/Cursor.app")


# ---------------------------------------------------------------------------
# Path match installs
# ---------------------------------------------------------------------------


def test_check_harness_path_match_installs(tmp):
    claude_dir = tmp / ".claude"
    claude_dir.mkdir(parents=True)
    (claude_dir / "settings.json").write_text("{}")

    result = check_harness(
        "claude-code",
        CheckOptions(env=_env_home(str(tmp)), cwd="/repo"),
    )
    assert result.installed
    assert result.executable_path is None
    assert result.matched_paths
    settings = _find_path(result, "settings")
    assert settings is not None
    assert settings.exists


# ---------------------------------------------------------------------------
# Executable match installs
# ---------------------------------------------------------------------------


def _make_executable(path: Path, content: str = "#!/bin/sh\nexit 0\n") -> None:
    path.write_text(content)
    if sys.platform != "win32":
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_check_harness_executable_match_installs(tmp):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    if sys.platform == "win32":
        exe_path = bin_dir / "codex.exe"
        exe_path.write_text("")
    else:
        exe_path = bin_dir / "codex"
        _make_executable(exe_path)

    env = {"HOME": "/Users/test", "PATH": str(bin_dir)}
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert result.installed
    assert result.executable_path == os.path.normpath(str(exe_path))


def test_check_harness_non_executable_does_not_match(tmp):
    if sys.platform == "win32":
        pytest.skip("unix-only test")

    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    exe_path = bin_dir / "codex"
    exe_path.write_text("#!/bin/sh\nexit 0\n")  # 0o644 — no executable bit

    env = {"HOME": str(tmp), "PATH": str(bin_dir)}
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert not result.installed
    assert result.executable_path is None


# ---------------------------------------------------------------------------
# Reasons and matched paths
# ---------------------------------------------------------------------------


def test_check_harness_reasons_and_matched_paths(tmp):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    if sys.platform == "win32":
        exe_path = bin_dir / "codex.exe"
        exe_path.write_text("")
    else:
        exe_path = bin_dir / "codex"
        _make_executable(exe_path)

    codex_home = tmp / "codex-home"
    codex_home.mkdir(parents=True)
    (codex_home / "config.toml").write_text("")

    env = {
        "HOME": str(tmp),
        "CODEX_HOME": str(codex_home),
        "PATH": str(bin_dir),
    }
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert result.installed
    assert "executable:codex" in result.reasons
    assert "config:config" in result.reasons

    config = _find_path(result, "config")
    assert config is not None
    assert config.exists
    assert config.path == os.path.normpath(str(codex_home / "config.toml"))


# ---------------------------------------------------------------------------
# Windows executable tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform != "win32", reason="windows-only test")
def test_find_executable_windows_exe(tmp):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    exe_path = bin_dir / "codex.exe"
    exe_path.write_text("")

    env = {
        "HOME": "/Users/test",
        "PATH": str(bin_dir),
        "PATHEXT": ".EXE;.CMD;.BAT;.COM",
    }
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert result.installed
    assert result.executable_path == os.path.normpath(str(exe_path))


@pytest.mark.skipif(sys.platform != "win32", reason="windows-only test")
def test_find_executable_windows_bat(tmp):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    bat_path = bin_dir / "codex.bat"
    bat_path.write_text("")

    env = {
        "HOME": "/Users/test",
        "PATH": str(bin_dir),
        "PATHEXT": ".EXE;.CMD;.BAT;.COM",
    }
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert result.installed
    assert result.executable_path == os.path.normpath(str(bat_path))


@pytest.mark.skipif(sys.platform != "win32", reason="windows-only test")
def test_find_executable_windows_no_match(tmp):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / "codex").write_text("")  # no PATHEXT extension

    env = {
        "HOME": "/Users/test",
        "PATH": str(bin_dir),
        "PATHEXT": ".EXE",
    }
    result = check_harness("codex", CheckOptions(env=env, cwd="/repo"))

    assert not result.installed
    assert result.executable_path is None


# ---------------------------------------------------------------------------
# Registry schema validation (basic, mirrors the Go/Rust tests)
# ---------------------------------------------------------------------------


_KEY_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_ROOT_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_ALLOWED_PLATFORMS = {
    "aix",
    "android",
    "cygwin",
    "darwin",
    "freebsd",
    "haiku",
    "linux",
    "netbsd",
    "openbsd",
    "sunos",
    "win32",
}
_SUPPORT_AREAS = ("config", "skills", "commands", "agents", "dotAgents")
_SUPPORT_SCOPES = ("global", "local")
_SUPPORT_STATUSES = {"supported", "unsupported", "unknown"}
_SUPPORT_CONFIDENCE = {"official", "source", "observed", "inferred", "unknown"}


def _is_valid_key(s: str) -> bool:
    return bool(_KEY_RE.match(s))


def _is_valid_root_name(s: str) -> bool:
    return bool(_ROOT_NAME_RE.match(s))


def _validate_template(s: str) -> bool:
    """Check that every ${...} in the template contains a valid uppercase
    identifier."""
    i = 0
    b = s.encode("utf-8")
    while i < len(b):
        if b[i : i + 2] == b"${":
            rest = s[i + 2 :]
            end = rest.find("}")
            if end == -1:
                return False  # unclosed ${
            inner = rest[:end]
            if not _is_valid_root_name(inner):
                return False
            i = i + 2 + end + 1
        else:
            i += 1
    return True


def _validate_support(key: str, support: dict) -> None:
    for area in _SUPPORT_AREAS:
        assert area in support, (
            f"support.{area} is required when support is present for key {key}"
        )
        area_value = support[area]
        assert isinstance(area_value, dict), (
            f"support.{area} must be an object for key {key}"
        )
        for scope in _SUPPORT_SCOPES:
            assert scope in area_value, (
                f"support.{area}.{scope} is required for key {key}"
            )
            leaf = area_value[scope]
            assert isinstance(leaf, dict), (
                f"support.{area}.{scope} must be an object for key {key}"
            )
            assert leaf.get("status") in _SUPPORT_STATUSES, (
                f"unsupported support status for key {key} area {area} scope {scope}: {leaf.get('status')!r}"
            )
            assert leaf.get("confidence") in _SUPPORT_CONFIDENCE, (
                f"unsupported support confidence for key {key} area {area} scope {scope}: {leaf.get('confidence')!r}"
            )
            assert isinstance(leaf.get("sources"), list), (
                f"support.{area}.{scope}.sources must be an array for key {key}"
            )
            for source in leaf["sources"]:
                assert isinstance(source, str) and source.startswith("https://"), (
                    f"support source must be an https URL for key {key} area {area} scope {scope}: {source}"
                )
            assert isinstance(leaf.get("paths"), list), (
                f"support.{area}.{scope}.paths must be an array for key {key}"
            )
            for support_path in leaf["paths"]:
                assert support_path["id"], (
                    f"support path id must be non-empty for key {key} area {area} scope {scope}"
                )
                assert support_path["kind"] in {"file", "dir"}, (
                    f"support path kind {support_path['kind']!r} invalid for key {key} area {area} scope {scope}"
                )
                assert _validate_template(support_path["template"]), (
                    f"support path template {support_path['template']!r} invalid for key {key} area {area} scope {scope}"
                )
                for platform in support_path.get("platforms", []):
                    assert platform in _ALLOWED_PLATFORMS, (
                        f"unsupported support path platform {platform!r} for key {key} area {area} scope {scope}"
                    )


def test_registry_validates_against_schema():
    shared = (
        Path(__file__).resolve().parents[2] / "data" / "harnesses.json"
    ).read_text(encoding="utf-8")
    schema = (
        Path(__file__).resolve().parents[2] / "data" / "harnesses.schema.json"
    ).read_text(encoding="utf-8")
    import json

    raw = json.loads(shared)
    schema_raw = json.loads(schema)
    for name in (
        "HarnessSupport",
        "HarnessSupportArea",
        "HarnessSupportScope",
        "HarnessSupportPath",
    ):
        assert name in schema_raw["$defs"], f"schema must define $defs.{name}"
    assert raw["version"] == 1
    harnesses = raw["harnesses"]
    assert len(harnesses) >= 10

    seen: set[str] = set()
    for h in harnesses:
        key = h["key"]
        assert key not in seen, f"duplicate key: {key}"
        seen.add(key)
        assert _is_valid_key(key), f"key {key!r} does not match ^[a-z][a-z0-9-]*$"
        assert h["name"], f"name is empty for key {key}"
        assert isinstance(h["aliases"], list), f"aliases must be a list for key {key}"
        assert isinstance(h["executables"], list), (
            f"executables must be a list for key {key}"
        )
        assert isinstance(h["paths"], list), f"paths must be a list for key {key}"
        assert isinstance(h["env"], list), f"env must be a list for key {key}"
        sources = h["sources"]
        assert len(sources) >= 1, f"sources must be non-empty for key {key}"
        for s in sources:
            assert s.startswith("https://"), (
                f"source must be an https URL for key {key}: {s}"
            )

        assert "support" in h, f"support must be present for key {key}"
        _validate_support(key, h["support"])

        for p in h["paths"]:
            assert p["id"], f"path id must be non-empty for key {key}"
            assert p["category"] in {
                "install",
                "config",
                "state",
                "cache",
                "project",
            }, f"path category {p['category']!r} invalid for key {key}"
            assert p["kind"] in {"file", "dir"}, (
                f"path kind {p['kind']!r} invalid for key {key}"
            )
            assert _validate_template(p["template"]), (
                f"path template {p['template']!r} invalid for key {key}"
            )
            for pl in p.get("platforms", []):
                assert pl in _ALLOWED_PLATFORMS, (
                    f"unsupported path platform {pl!r} for key {key}"
                )

        for e in h["env"]:
            assert e["name"], f"env name must be non-empty for key {key}"
            assert e["description"], f"env description must be non-empty for key {key}"

        for r in h.get("roots", []):
            assert _is_valid_root_name(r["name"]), (
                f"root.name {r['name']!r} must match ^[A-Z][A-Z0-9_]*$ for key {key}"
            )
            if "env" in r:
                assert r["env"], f"root env must be non-empty for key {key}"
            if "use" in r:
                assert _validate_template(r["use"]), (
                    f"root.use {r['use']!r} invalid for key {key}"
                )
            assert _validate_template(r["fallback"]), (
                f"root.fallback {r['fallback']!r} invalid for key {key}"
            )

        installations = h["installations"]
        assert installations, f"installations must be non-empty for key {key}"
        for installation in installations:
            assert installation["method"] in {
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
                "unknown",
            }, f"unsupported install method {installation['method']!r} for key {key}"
            assert installation["url"].startswith("https://"), (
                f"installation url must be https for key {key}"
            )
            if "package" in installation:
                assert installation["package"], (
                    f"installation package must be non-empty for key {key}"
                )
            if "command" in installation:
                assert installation["command"], (
                    f"installation command must be non-empty for key {key}"
                )
            if "notes" in installation:
                assert installation["notes"], (
                    f"installation notes must be non-empty for key {key}"
                )
            for platform in installation.get("platforms", []):
                assert platform in _ALLOWED_PLATFORMS, (
                    f"unsupported installation platform {platform!r} for key {key}"
                )


# ---------------------------------------------------------------------------
# Internal: template resolution unit tests
# ---------------------------------------------------------------------------


def test_resolve_template_unresolved_returns_none():
    env = {"HOME": "/Users/test"}
    # CODEX_ROOT is unset → whole template is None.
    assert harness_detect._resolve_template("${CODEX_ROOT}/config.toml", env) is None
    assert harness_detect._resolve_template(
        "${HOME}/.codex/config.toml", env
    ) == os.path.normpath("/Users/test/.codex/config.toml")
