"""Detect installed LLM harnesses and resolve their config/state paths.

This is a Python port of the ``@auron-labs/harness-detect`` TypeScript package,
the Go package at ``github.com/auron/harness-detect/packages/golang/harnessdetect``,
and the ``harness-detect`` Rust crate. It shares the same harness registry
(``data/harnesses.json``) and exposes the same API surface, adapted to
idiomatic Python naming.

Detection is data-driven: a harness counts as **installed** when a matching
executable is found on ``PATH`` **or** one or more of its known
config/state/cache/install/project paths exist on disk. All harness-specific
behavior lives in the registry JSON; this module contains no harness-specific
code paths.
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from typing import Optional

__all__ = [
    "CheckOptions",
    "HarnessCheckResult",
    "HarnessDefinition",
    "HarnessEnvVar",
    "HarnessError",
    "HarnessInstallation",
    "HarnessMatrix",
    "HarnessPathSpec",
    "HarnessRootDef",
    "HarnessSupport",
    "HarnessSupportArea",
    "HarnessSupportPath",
    "HarnessSupportRecord",
    "HarnessSupportScope",
    "ResolvedHarnessPath",
    "check_harness",
    "detect_harnesses",
    "detect_installed_harnesses",
    "get_raw_harness_data",
    "get_harness_matrix",
    "get_harness_support",
    "list_harnesses",
    "list_harness_support",
]

__version__ = "0.1.0"


# ---------------------------------------------------------------------------
# Registry loading (read at load time, mirroring the TypeScript approach)
# ---------------------------------------------------------------------------


def _load_matrix() -> HarnessMatrix:
    """Load and parse the bundled registry JSON."""
    with (
        resources.files("harness_detect.data")
        .joinpath("harnesses.json")
        .open("r", encoding="utf-8") as f
    ):
        raw = json.load(f)
    return HarnessMatrix(
        version=raw["version"],
        harnesses=tuple(HarnessDefinition.from_dict(h) for h in raw["harnesses"]),
    )


_MATRIX: Optional[HarnessMatrix] = None


def _matrix() -> HarnessMatrix:
    global _MATRIX
    if _MATRIX is None:
        _MATRIX = _load_matrix()
    return _MATRIX


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HarnessEnvVar:
    """A harness-relevant environment variable (documentation only)."""

    name: str
    description: str

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessEnvVar":
        return cls(name=d["name"], description=d["description"])


@dataclass(frozen=True)
class HarnessPathSpec:
    """One path template to check for a harness."""

    id: str
    category: str
    kind: str
    template: str
    platforms: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessPathSpec":
        return cls(
            id=d["id"],
            category=d["category"],
            kind=d["kind"],
            template=d["template"],
            platforms=tuple(d.get("platforms", [])),
        )


@dataclass(frozen=True)
class HarnessSupportPath:
    """One support-related path template."""

    id: str
    kind: str
    template: str
    platforms: tuple[str, ...] = ()
    description: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessSupportPath":
        return cls(
            id=d["id"],
            kind=d["kind"],
            template=d["template"],
            platforms=tuple(d.get("platforms", [])),
            description=d.get("description", ""),
        )


@dataclass(frozen=True)
class HarnessSupportScope:
    """One support capability leaf for one scope."""

    status: str
    paths: tuple[HarnessSupportPath, ...]
    sources: tuple[str, ...]
    confidence: str
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessSupportScope":
        return cls(
            status=d["status"],
            paths=tuple(HarnessSupportPath.from_dict(p) for p in d.get("paths", [])),
            sources=tuple(d.get("sources", [])),
            confidence=d["confidence"],
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class HarnessSupportArea:
    """One support capability area."""

    global_: HarnessSupportScope
    local: HarnessSupportScope

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessSupportArea":
        return cls(
            global_=HarnessSupportScope.from_dict(d["global"]),
            local=HarnessSupportScope.from_dict(d["local"]),
        )


@dataclass(frozen=True)
class HarnessSupport:
    """Support metadata for a harness."""

    config: HarnessSupportArea
    skills: HarnessSupportArea
    commands: HarnessSupportArea
    agents: HarnessSupportArea
    dot_agents: HarnessSupportArea

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessSupport":
        return cls(
            config=HarnessSupportArea.from_dict(d["config"]),
            skills=HarnessSupportArea.from_dict(d["skills"]),
            commands=HarnessSupportArea.from_dict(d["commands"]),
            agents=HarnessSupportArea.from_dict(d["agents"]),
            dot_agents=HarnessSupportArea.from_dict(d["dotAgents"]),
        )


@dataclass(frozen=True)
class HarnessRootDef:
    """A derived template variable declared by a harness.

    Roots are resolved in declaration order before path templates, allowing
    later roots to reference earlier ones.
    """

    name: str
    env: str = ""
    use: str = ""
    fallback: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessRootDef":
        return cls(
            name=d["name"],
            env=d.get("env", ""),
            use=d.get("use", ""),
            fallback=d["fallback"],
        )


@dataclass(frozen=True)
class HarnessInstallation:
    """One documented installation method."""

    method: str
    package: str = ""
    command: str = ""
    url: str = ""
    marketplace: str = ""
    id: str = ""
    platforms: tuple[str, ...] = ()
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessInstallation":
        return cls(
            method=d["method"],
            package=d.get("package", ""),
            command=d.get("command", ""),
            url=d.get("url", ""),
            marketplace=d.get("marketplace", ""),
            id=d.get("id", ""),
            platforms=tuple(d.get("platforms", [])),
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class HarnessDefinition:
    """A single LLM harness definition."""

    key: str
    name: str
    aliases: tuple[str, ...]
    executables: tuple[str, ...]
    installations: tuple[HarnessInstallation, ...]
    paths: tuple[HarnessPathSpec, ...]
    roots: tuple[HarnessRootDef, ...]
    support: HarnessSupport
    env: tuple[HarnessEnvVar, ...]
    sources: tuple[str, ...]

    @classmethod
    def from_dict(cls, d: dict) -> "HarnessDefinition":
        return cls(
            key=d["key"],
            name=d["name"],
            aliases=tuple(d.get("aliases", [])),
            executables=tuple(d.get("executables", [])),
            installations=tuple(
                HarnessInstallation.from_dict(i) for i in d.get("installations", [])
            ),
            paths=tuple(HarnessPathSpec.from_dict(p) for p in d.get("paths", [])),
            roots=tuple(HarnessRootDef.from_dict(r) for r in d.get("roots", [])),
            support=HarnessSupport.from_dict(d["support"]),
            env=tuple(HarnessEnvVar.from_dict(e) for e in d.get("env", [])),
            sources=tuple(d.get("sources", [])),
        )


@dataclass(frozen=True)
class HarnessMatrix:
    """The top-level registry document."""

    version: int
    harnesses: tuple[HarnessDefinition, ...]


@dataclass(frozen=True)
class HarnessSupportRecord:
    """One harness support entry."""

    key: str
    name: str
    support: HarnessSupport


@dataclass(frozen=True)
class ResolvedHarnessPath:
    """A resolved path entry: the original spec plus the resolved path and
    whether it exists on disk."""

    id: str
    category: str
    kind: str
    template: str
    platforms: tuple[str, ...]
    path: Optional[str]
    exists: bool


@dataclass
class CheckOptions:
    """Options passed to :func:`check_harness` and :func:`detect_harnesses`.

    When ``env`` is ``None`` the real process environment is used. When
    provided, it **replaces** the process environment entirely (defaults are
    still filled in for ``HOME``, ``XDG_*``, ``TMPDIR``, ``CWD``).
    """

    env: Optional[dict[str, str]] = None
    cwd: Optional[str] = None


@dataclass
class HarnessCheckResult:
    """The result of checking a single harness."""

    key: str
    name: str
    installed: bool
    executable_path: Optional[str]
    harness: HarnessDefinition
    paths: list[ResolvedHarnessPath] = field(default_factory=list)
    matched_paths: list[ResolvedHarnessPath] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)


class HarnessError(Exception):
    """Raised when a harness key or alias is not found."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_raw_harness_data() -> HarnessMatrix:
    """Return the full registry (immutable)."""
    return _matrix()


def get_harness_matrix() -> HarnessMatrix:
    """Return the full registry (immutable)."""
    return get_raw_harness_data()


def list_harnesses() -> list[HarnessDefinition]:
    """Return the list of harness definitions (immutable)."""
    return list(_matrix().harnesses)


def get_harness_support(input: str) -> HarnessSupportRecord:
    """Return support metadata for one harness by key or alias."""
    harness = _find_harness_definition(input)
    if harness is None:
        raise HarnessError(f"Unknown harness: {input}")
    return HarnessSupportRecord(
        key=harness.key,
        name=harness.name,
        support=harness.support,
    )


def list_harness_support() -> list[HarnessSupportRecord]:
    """Return support metadata for all harnesses."""
    return [
        HarnessSupportRecord(key=h.key, name=h.name, support=h.support)
        for h in _matrix().harnesses
    ]


def check_harness(
    input: str, options: Optional[CheckOptions] = None
) -> HarnessCheckResult:
    """Check a single harness by key or alias (case-insensitive, trimmed).

    Raises :class:`HarnessError` with the message ``"Unknown harness: <input>"``
    if the key/alias is not found.
    """
    opts = options or CheckOptions()
    harness = _find_harness_definition(input)
    if harness is None:
        raise HarnessError(f"Unknown harness: {input}")

    base_env = _with_defaults(opts.env, opts.cwd)
    env = _resolve_harness_roots(harness, base_env)
    executable_path = _find_executable(harness.executables, env)
    paths = _resolve_paths(harness, env)
    matched_paths = [p for p in paths if p.exists]
    reasons: list[str] = []

    if executable_path is not None:
        reasons.append(f"executable:{os.path.basename(executable_path)}")

    for entry in matched_paths:
        reasons.append(f"{entry.category}:{entry.id}")

    return HarnessCheckResult(
        key=harness.key,
        name=harness.name,
        installed=executable_path is not None or bool(matched_paths),
        executable_path=executable_path,
        harness=harness,
        paths=paths,
        matched_paths=matched_paths,
        reasons=reasons,
    )


def detect_harnesses(
    options: Optional[CheckOptions] = None,
) -> list[HarnessCheckResult]:
    """Check every harness in the registry, returning one result per entry."""
    opts = options or CheckOptions()
    return [check_harness(h.key, opts) for h in _matrix().harnesses]


def detect_installed_harnesses(
    options: Optional[CheckOptions] = None,
) -> list[HarnessCheckResult]:
    """Return the subset of :func:`detect_harnesses` results whose ``installed``
    field is ``True``."""
    return [r for r in detect_harnesses(options) if r.installed]


# ---------------------------------------------------------------------------
# Internal: lookup
# ---------------------------------------------------------------------------


def _find_harness_definition(input: str) -> Optional[HarnessDefinition]:
    key = input.strip().lower()
    for harness in _matrix().harnesses:
        if harness.key.lower() == key:
            return harness
        if any(a.lower() == key for a in harness.aliases):
            return harness
    return None


# ---------------------------------------------------------------------------
# Internal: environment defaults
# ---------------------------------------------------------------------------


def _with_defaults(
    env: Optional[dict[str, str]],
    cwd: Optional[str],
) -> dict[str, str]:
    """Compute the universal base-variable map (HOME, XDG_*, TMPDIR, CWD)
    plus any caller-supplied env vars. Harness-specific derived roots are
    resolved separately by :func:`_resolve_harness_roots`.
    """
    out: dict[str, str] = dict(env) if env is not None else dict(os.environ)

    home = out.get("HOME", "") or os.path.expanduser("~") or "/"
    userprofile = out.get("USERPROFILE", "") or home

    xdg_config_home = out.get("XDG_CONFIG_HOME", "") or os.path.join(home, ".config")
    xdg_data_home = out.get("XDG_DATA_HOME", "") or os.path.join(
        home, ".local", "share"
    )
    xdg_state_home = out.get("XDG_STATE_HOME", "") or os.path.join(
        home, ".local", "state"
    )
    xdg_cache_home = out.get("XDG_CACHE_HOME", "") or os.path.join(home, ".cache")

    if cwd:
        cwd_val = cwd
    else:
        cwd_val = os.getcwd() or "."

    tmpdir = out.get("TMPDIR", "") or tempfile_gettempdir()

    out["HOME"] = home
    out["USERPROFILE"] = userprofile
    out["XDG_CONFIG_HOME"] = xdg_config_home
    out["XDG_DATA_HOME"] = xdg_data_home
    out["XDG_STATE_HOME"] = xdg_state_home
    out["XDG_CACHE_HOME"] = xdg_cache_home
    out["TMPDIR"] = tmpdir
    out["CWD"] = cwd_val

    return out


def tempfile_gettempdir() -> str:
    import tempfile

    return tempfile.gettempdir()


# ---------------------------------------------------------------------------
# Internal: harness root resolution
# ---------------------------------------------------------------------------


def _resolve_harness_roots(
    harness: HarnessDefinition,
    base_env: dict[str, str],
) -> dict[str, str]:
    """Resolve the harness-specific derived template variables declared in
    ``harness.roots``. Resolution order follows declaration order so that later
    roots can reference earlier roots in their ``fallback`` and ``use``
    templates.
    """
    out = dict(base_env)

    for root in harness.roots:
        env_val = base_env.get(root.env, "") if root.env else ""
        env_val_nonempty = env_val if env_val else ""

        if root.env and env_val_nonempty:
            if root.use:
                # Resolve "use" against base env + resolved roots + the env var itself.
                tmp = dict(out)
                tmp[root.env] = env_val_nonempty
                value = _resolve_template(root.use, tmp)
            else:
                value = env_val_nonempty
        else:
            value = _resolve_template(root.fallback, out)

        if value is not None and value != "":
            out[root.name] = os.path.normpath(value)

    return out


# ---------------------------------------------------------------------------
# Internal: template resolution
# ---------------------------------------------------------------------------

_TEMPLATE_VAR = re.compile(r"\$\{([^}]+)\}")


def _resolve_template(template: str, env: dict[str, str]) -> Optional[str]:
    """Replace all ``${VAR}`` placeholders with values from ``env``.

    If any placeholder value is missing or empty, the **entire template
    resolves to ``None``** (matching the TypeScript ``null`` / Go empty-string /
    Rust ``None`` semantics). The resolved string is normalized via
    :func:`os.path.normpath`.
    """
    if not template:
        return None

    unresolved = False

    def repl(m: re.Match[str]) -> str:
        nonlocal unresolved
        name = m.group(1)
        value = env.get(name)
        if value is None or value == "":
            unresolved = True
            return ""
        return value

    resolved = _TEMPLATE_VAR.sub(repl, template)

    if unresolved:
        return None

    return os.path.normpath(resolved)


# ---------------------------------------------------------------------------
# Internal: platform + filesystem checks
# ---------------------------------------------------------------------------


def _current_platform() -> str:
    """Return the current platform identifier using the Node.js convention
    (``darwin``, ``linux``, ``win32``, ...) so it matches the registry's
    ``platforms[]`` values.
    """
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "win32":
        return "win32"
    if sys.platform.startswith("freebsd"):
        return "freebsd"
    return sys.platform


def _platform_matches(platforms: tuple[str, ...]) -> bool:
    if not platforms:
        return True
    plat = _current_platform()
    return plat in platforms


def _path_type_matches(kind: str, candidate_path: str) -> bool:
    p = Path(candidate_path)
    try:
        if kind == "dir":
            return p.is_dir()
        return p.is_file()
    except OSError:
        return False


def _executable_file_matches(candidate_path: str) -> bool:
    if not _path_type_matches("file", candidate_path):
        return False
    if sys.platform == "win32":
        return True
    # Non-Windows: check the executable bit (any of owner/group/other).
    try:
        st = os.stat(candidate_path)
    except OSError:
        return False
    return bool(st.st_mode & 0o111)


def _resolve_paths(
    harness: HarnessDefinition,
    env: dict[str, str],
) -> list[ResolvedHarnessPath]:
    out: list[ResolvedHarnessPath] = []
    for entry in harness.paths:
        if not _platform_matches(entry.platforms):
            continue
        resolved = _resolve_template(entry.template, env)
        exists = bool(resolved) and _path_type_matches(entry.kind, resolved)
        out.append(
            ResolvedHarnessPath(
                id=entry.id,
                category=entry.category,
                kind=entry.kind,
                template=entry.template,
                platforms=entry.platforms,
                path=resolved,
                exists=exists,
            )
        )
    return out


def _find_executable(
    executables: tuple[str, ...],
    env: dict[str, str],
) -> Optional[str]:
    if not executables:
        return None

    path_value = env.get("PATH", "")
    delimiter = ";" if sys.platform == "win32" else os.pathsep
    path_parts = [p for p in path_value.split(delimiter) if p]

    if sys.platform == "win32":
        pathext = env.get("PATHEXT", ".EXE;.CMD;.BAT;.COM")
        exts = pathext.split(";")
    else:
        exts = [""]

    for executable in executables:
        for d in path_parts:
            for ext in exts:
                candidate = os.path.join(d, executable + ext)
                if _executable_file_matches(candidate):
                    return os.path.normpath(candidate)

    return None
