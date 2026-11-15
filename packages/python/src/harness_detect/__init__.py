"""Detect installed LLM harnesses and resolve their config/state paths.

This is a Python port of the ``@auron-labs/harness-detect`` TypeScript package,
the Go package at ``github.com/auron-labs/harness-detect/packages/golang/harnessdetect``,
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
from collections.abc import Mapping
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from types import MappingProxyType

__all__ = [
    "CheckOptions",
    "HarnessAcp",
    "HarnessAcpLaunch",
    "HarnessAcpRecord",
    "HarnessCheckResult",
    "HarnessDefinition",
    "HarnessEnvVar",
    "HarnessError",
    "HarnessInstallation",
    "HarnessMatrix",
    "HarnessMcp",
    "HarnessMcpRecord",
    "HarnessMcpRemoteFormat",
    "HarnessMcpScope",
    "HarnessMcpServerFormat",
    "HarnessMcpStdioFormat",
    "HarnessPathSpec",
    "HarnessRootDef",
    "HarnessSupport",
    "HarnessSupportArea",
    "HarnessSupportPath",
    "HarnessSupportRecord",
    "HarnessSupportScope",
    "InstalledAcpLaunch",
    "McpSkippedServer",
    "McpTranslation",
    "ResolvedHarnessPath",
    "check_harness",
    "detect_harnesses",
    "detect_installed_acp_launches",
    "detect_installed_harnesses",
    "get_harness_acp",
    "get_harness_matrix",
    "get_harness_mcp",
    "get_harness_support",
    "get_raw_harness_data",
    "list_harness_acp",
    "list_harness_mcp",
    "list_harness_support",
    "list_harnesses",
    "translate_mcp_json",
]

__version__ = "0.4.0"


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


_MATRIX: HarnessMatrix | None = None


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
    def from_dict(cls, d: dict) -> HarnessEnvVar:
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
    def from_dict(cls, d: dict) -> HarnessPathSpec:
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
    def from_dict(cls, d: dict) -> HarnessSupportPath:
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
    def from_dict(cls, d: dict) -> HarnessSupportScope:
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
    def from_dict(cls, d: dict) -> HarnessSupportArea:
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
    # Discovery of Agent Skills from the shared ``.agents/skills`` directory.
    agents_skills: HarnessSupportArea

    @classmethod
    def from_dict(cls, d: dict) -> HarnessSupport:
        return cls(
            config=HarnessSupportArea.from_dict(d["config"]),
            skills=HarnessSupportArea.from_dict(d["skills"]),
            commands=HarnessSupportArea.from_dict(d["commands"]),
            agents=HarnessSupportArea.from_dict(d["agents"]),
            agents_skills=HarnessSupportArea.from_dict(d["agentsSkills"]),
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
    fallback_env: str = ""
    fallback: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessRootDef:
        return cls(
            name=d["name"],
            env=d.get("env", ""),
            use=d.get("use", ""),
            fallback_env=d.get("fallbackEnv", ""),
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
    def from_dict(cls, d: dict) -> HarnessInstallation:
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
class HarnessAcpLaunch:
    """A local stdio command with discrete argv values."""

    command: str
    args: tuple[str, ...]
    platforms: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, d: dict) -> HarnessAcpLaunch:
        return cls(d["command"], tuple(d["args"]), tuple(d.get("platforms", [])))


@dataclass(frozen=True)
class HarnessAcp:
    """ACP metadata, independently of file-location support."""

    status: str = "unknown"
    sources: tuple[str, ...] = ()
    confidence: str = "unknown"
    launches: tuple[HarnessAcpLaunch, ...] = ()
    # Launches that start the agent from a binary already on PATH; never a
    # package runner.
    installed_launches: tuple[HarnessAcpLaunch, ...] = ()
    adapter: str = ""
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessAcp:
        return cls(
            status=d["status"],
            sources=tuple(d["sources"]),
            confidence=d["confidence"],
            launches=tuple(
                HarnessAcpLaunch.from_dict(item) for item in d.get("launches", [])
            ),
            installed_launches=tuple(
                HarnessAcpLaunch.from_dict(item)
                for item in d.get("installedLaunches", [])
            ),
            adapter=d.get("adapter", ""),
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class InstalledAcpLaunch:
    """A runnable ACP launch for an installed harness.

    ``command`` is the absolute path of the resolved executable.
    """

    key: str
    name: str
    command: str
    args: tuple[str, ...]


@dataclass(frozen=True)
class HarnessAcpRecord:
    """One harness ACP entry."""

    key: str
    name: str
    acp: HarnessAcp


@dataclass(frozen=True)
class HarnessMcpScope:
    """Where a harness stores MCP servers for one scope.

    ``format`` (json, jsonc, toml, yaml) and ``key_path`` are set when
    ``status`` is supported and ``paths`` is non-empty.
    """

    status: str
    paths: tuple[HarnessSupportPath, ...]
    sources: tuple[str, ...]
    confidence: str
    format: str = ""
    key_path: tuple[str, ...] = ()
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessMcpScope:
        return cls(
            status=d["status"],
            paths=tuple(HarnessSupportPath.from_dict(p) for p in d["paths"]),
            sources=tuple(d["sources"]),
            confidence=d["confidence"],
            format=d.get("format", ""),
            key_path=tuple(d.get("keyPath", [])),
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class HarnessMcpStdioFormat:
    """Native field names of a stdio MCP server entry.

    An empty ``args`` means the command field holds an argv array
    ``[command, *args]``; an empty ``env`` means env cannot be set.
    """

    command: str
    type: str = ""
    args: str = ""
    env: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessMcpStdioFormat:
        return cls(
            command=d["command"],
            type=d.get("type", ""),
            args=d.get("args", ""),
            env=d.get("env", ""),
        )


@dataclass(frozen=True)
class HarnessMcpRemoteFormat:
    """Native field names of a remote MCP server entry.

    An empty ``headers`` means headers cannot be set.
    """

    url: str
    type: str = ""
    headers: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessMcpRemoteFormat:
        return cls(url=d["url"], type=d.get("type", ""), headers=d.get("headers", ""))


@dataclass(frozen=True)
class HarnessMcpServerFormat:
    """Describes one native MCP server entry so ``.mcp.json`` servers can be
    translated without harness-specific code."""

    container: str
    stdio: HarnessMcpStdioFormat
    name_field: str = ""
    type_field: str = ""
    http: HarnessMcpRemoteFormat | None = None
    sse: HarnessMcpRemoteFormat | None = None
    defaults: Mapping[str, object] = field(default_factory=lambda: MappingProxyType({}))

    @classmethod
    def from_dict(cls, d: dict) -> HarnessMcpServerFormat:
        return cls(
            container=d["container"],
            stdio=HarnessMcpStdioFormat.from_dict(d["stdio"]),
            name_field=d.get("nameField", ""),
            type_field=d.get("typeField", ""),
            http=HarnessMcpRemoteFormat.from_dict(d["http"]) if "http" in d else None,
            sse=HarnessMcpRemoteFormat.from_dict(d["sse"]) if "sse" in d else None,
            defaults=MappingProxyType(dict(d.get("defaults", {}))),
        )


@dataclass(frozen=True)
class HarnessMcp:
    """MCP client metadata for a harness.

    ``status`` reports whether the harness can use MCP servers; ``mcp_json``
    reports whether it natively reads the project-root ``.mcp.json``.
    """

    status: str
    mcp_json: str
    global_: HarnessMcpScope
    local: HarnessMcpScope
    sources: tuple[str, ...]
    confidence: str
    server_format: HarnessMcpServerFormat | None = None
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> HarnessMcp:
        return cls(
            status=d["status"],
            mcp_json=d["mcpJson"],
            global_=HarnessMcpScope.from_dict(d["global"]),
            local=HarnessMcpScope.from_dict(d["local"]),
            sources=tuple(d["sources"]),
            confidence=d["confidence"],
            server_format=(
                HarnessMcpServerFormat.from_dict(d["serverFormat"])
                if "serverFormat" in d
                else None
            ),
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class HarnessMcpRecord:
    """One harness MCP entry."""

    key: str
    name: str
    mcp: HarnessMcp


@dataclass(frozen=True)
class McpSkippedServer:
    """A ``.mcp.json`` server the native format cannot represent."""

    name: str
    reason: str


@dataclass
class McpTranslation:
    """A ``.mcp.json`` document translated into a harness's native MCP config.

    ``servers`` is a dict keyed by server name, or a list for array
    containers. ``config`` nests ``servers`` under ``key_path``.
    """

    key: str
    name: str
    scope: str
    format: str
    key_path: list[str]
    servers: dict | list
    config: dict
    skipped: list[McpSkippedServer] = field(default_factory=list)


@dataclass(frozen=True)
class HarnessDefinition:
    """A single LLM harness definition."""

    key: str
    name: str
    # Upstream version the entry was last verified against, or "unknown".
    version: str
    aliases: tuple[str, ...]
    executables: tuple[str, ...]
    installations: tuple[HarnessInstallation, ...]
    paths: tuple[HarnessPathSpec, ...]
    roots: tuple[HarnessRootDef, ...]
    support: HarnessSupport
    env: tuple[HarnessEnvVar, ...]
    sources: tuple[str, ...]
    mcp: HarnessMcp
    acp: HarnessAcp | None = None

    @classmethod
    def from_dict(cls, d: dict) -> HarnessDefinition:
        return cls(
            key=d["key"],
            name=d["name"],
            version=d["version"],
            aliases=tuple(d.get("aliases", [])),
            executables=tuple(d.get("executables", [])),
            installations=tuple(
                HarnessInstallation.from_dict(i) for i in d.get("installations", [])
            ),
            paths=tuple(HarnessPathSpec.from_dict(p) for p in d.get("paths", [])),
            roots=tuple(HarnessRootDef.from_dict(r) for r in d.get("roots", [])),
            support=HarnessSupport.from_dict(d["support"]),
            acp=HarnessAcp.from_dict(d["acp"]) if "acp" in d else None,
            mcp=HarnessMcp.from_dict(d["mcp"]),
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
    path: str | None
    exists: bool


@dataclass
class CheckOptions:
    """Options passed to :func:`check_harness` and :func:`detect_harnesses`.

    When ``env`` is ``None`` the real process environment is used. When
    provided, it **replaces** the process environment entirely (defaults are
    still filled in for ``HOME``, ``XDG_*``, ``TMPDIR``, ``CWD``).
    """

    env: dict[str, str] | None = None
    cwd: str | None = None


@dataclass
class HarnessCheckResult:
    """The result of checking a single harness."""

    key: str
    name: str
    installed: bool
    executable_path: str | None
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


def get_harness_acp(input: str) -> HarnessAcpRecord:
    """Return ACP metadata by key or alias; missing metadata is unknown."""
    harness = _find_harness_definition(input)
    if harness is None:
        raise HarnessError(f"Unknown harness: {input}")
    return HarnessAcpRecord(harness.key, harness.name, harness.acp or HarnessAcp())


def list_harness_acp() -> list[HarnessAcpRecord]:
    """Return ACP metadata for all harnesses (immutable)."""
    return [
        HarnessAcpRecord(h.key, h.name, h.acp or HarnessAcp())
        for h in _matrix().harnesses
    ]


def get_harness_mcp(input: str) -> HarnessMcpRecord:
    """Return MCP metadata for one harness by key or alias."""
    harness = _find_harness_definition(input)
    if harness is None:
        raise HarnessError(f"Unknown harness: {input}")
    return HarnessMcpRecord(harness.key, harness.name, harness.mcp)


def list_harness_mcp() -> list[HarnessMcpRecord]:
    """Return MCP metadata for all harnesses (immutable)."""
    return [HarnessMcpRecord(h.key, h.name, h.mcp) for h in _matrix().harnesses]


_MCP_TRANSPORTS = ("stdio", "http", "sse")


def translate_mcp_json(
    input: str,
    mcp_json: Mapping[str, object] | str,
    *,
    scope: str = "local",
) -> McpTranslation:
    """Translate a project ``.mcp.json`` document into a harness's native MCP
    config for one scope.

    ``mcp_json`` is the parsed document or its JSON text. Nothing is read or
    written. Servers the native format cannot represent are listed in
    ``skipped``.
    """
    harness = _find_harness_definition(input)
    if harness is None:
        raise HarnessError(f"Unknown harness: {input}")
    if scope not in ("global", "local"):
        raise HarnessError(f"Unknown MCP scope: {scope}")

    mcp = harness.mcp
    leaf = mcp.global_ if scope == "global" else mcp.local
    fmt = mcp.server_format
    if (
        mcp.status != "supported"
        or leaf.status != "supported"
        or not leaf.format
        or fmt is None
    ):
        raise HarnessError(
            f"Harness {harness.key} has no file-based MCP config for scope {scope}"
        )

    document = json.loads(mcp_json) if isinstance(mcp_json, str) else mcp_json
    servers = document.get("mcpServers") if isinstance(document, Mapping) else None
    if not isinstance(servers, Mapping):
        raise HarnessError(".mcp.json must be an object with an mcpServers object")

    mapped: dict[str, dict] = {}
    entries: list[dict] = []
    skipped: list[McpSkippedServer] = []
    for name in sorted(servers):
        result = _translate_mcp_server(name, servers[name], fmt)
        if isinstance(result, str):
            skipped.append(McpSkippedServer(name, result))
        elif fmt.container == "array":
            entries.append(result)
        else:
            mapped[name] = result

    native: dict | list = entries if fmt.container == "array" else mapped
    config: object = native
    for segment in reversed(leaf.key_path):
        config = {segment: config}

    return McpTranslation(
        key=harness.key,
        name=harness.name,
        scope=scope,
        format=leaf.format,
        key_path=list(leaf.key_path),
        servers=native,
        config=json.loads(json.dumps(config)),
        skipped=skipped,
    )


def _translate_mcp_server(
    name: str, server: object, fmt: HarnessMcpServerFormat
) -> dict | str:
    """Return a native entry, or a reason string. Check order matches every
    package."""
    if not isinstance(server, Mapping):
        return "invalid server entry"

    if "type" in server:
        transport = server["type"]
        if not isinstance(transport, str):
            return "invalid server entry"
        if transport not in _MCP_TRANSPORTS:
            return f"unsupported transport: {transport}"
    elif "command" in server:
        transport = "stdio"
    elif "url" in server:
        transport = "http"
    else:
        return "missing command or url"

    remote = {"http": fmt.http, "sse": fmt.sse}.get(transport)
    if transport != "stdio" and remote is None:
        return f"unsupported transport: {transport}"

    entry: dict = dict(fmt.defaults)
    if fmt.name_field:
        entry[fmt.name_field] = name

    if remote is None:
        target = fmt.stdio
        if target.type:
            entry[fmt.type_field] = target.type
        command = server.get("command")
        if not isinstance(command, str) or not command:
            return "missing command"
        args = server.get("args")
        args = [] if args is None else args
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            return "invalid args"
        env = _optional_string_map(server.get("env"))
        if env is None:
            return "invalid env"
        if target.args:
            entry[target.command] = command
            entry[target.args] = list(args)
        else:
            entry[target.command] = [command, *args]
        if env:
            if not target.env:
                return "env not supported"
            entry[target.env] = env
        return entry

    if remote.type:
        entry[fmt.type_field] = remote.type
    url = server.get("url")
    if not isinstance(url, str) or not url:
        return "missing url"
    headers = _optional_string_map(server.get("headers"))
    if headers is None:
        return "invalid headers"
    entry[remote.url] = url
    if headers:
        if not remote.headers:
            return "headers not supported"
        entry[remote.headers] = headers
    return entry


def _optional_string_map(value: object) -> dict[str, str] | None:
    """Accept a missing value or an object of strings; ``None`` if invalid."""
    if value is None:
        return {}
    if not isinstance(value, Mapping) or not all(
        isinstance(item, str) for item in value.values()
    ):
        return None
    return dict(value)


def detect_installed_acp_launches(
    options: CheckOptions | None = None,
) -> list[InstalledAcpLaunch]:
    """List ACP agents that can be started from binaries already installed.

    An entry is returned when its ACP status is ``supported``, it does not
    delegate to an ``adapter``, and the command of its launch for the current
    platform resolves to an absolute executable path. Uses ``installed_launches``
    when present, otherwise ``launches`` that do not use a package runner.
    Nothing is executed.
    """
    opts = options or CheckOptions()
    env = _with_defaults(opts.env, opts.cwd)
    results: list[InstalledAcpLaunch] = []
    for harness in _matrix().harnesses:
        acp = harness.acp
        if acp is None or acp.status != "supported" or acp.adapter:
            continue
        launches = acp.installed_launches or tuple(
            launch for launch in acp.launches if not _is_package_runner(launch)
        )
        launch = next((x for x in launches if _platform_matches(x.platforms)), None)
        if launch is None:
            continue
        command = _find_executable((launch.command,), env, absolute_only=True)
        if command is not None:
            results.append(
                InstalledAcpLaunch(harness.key, harness.name, command, launch.args)
            )
    return results


def _is_package_runner(launch: HarnessAcpLaunch) -> bool:
    return launch.command in ("npx", "bunx", "uvx") or (
        launch.command == "pnpm" and launch.args[:1] == ("dlx",)
    )


def check_harness(
    input: str, options: CheckOptions | None = None
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
    options: CheckOptions | None = None,
) -> list[HarnessCheckResult]:
    """Check every harness in the registry, returning one result per entry."""
    opts = options or CheckOptions()
    return [check_harness(h.key, opts) for h in _matrix().harnesses]


def detect_installed_harnesses(
    options: CheckOptions | None = None,
) -> list[HarnessCheckResult]:
    """Return the subset of :func:`detect_harnesses` results whose ``installed``
    field is ``True``."""
    return [r for r in detect_harnesses(options) if r.installed]


# ---------------------------------------------------------------------------
# Internal: lookup
# ---------------------------------------------------------------------------


def _find_harness_definition(input: str) -> HarnessDefinition | None:
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
    env: dict[str, str] | None,
    cwd: str | None,
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
        fallback_env_val = (
            base_env.get(root.fallback_env, "") if root.fallback_env else ""
        )

        if root.env and env_val_nonempty:
            if root.use:
                # Resolve "use" against base env + resolved roots + the env var itself.
                tmp = dict(out)
                tmp[root.env] = env_val_nonempty
                value = _resolve_template(root.use, tmp)
            else:
                value = env_val_nonempty
        elif root.fallback_env and fallback_env_val:
            # Use the documented legacy override before the static fallback.
            value = fallback_env_val
        else:
            value = _resolve_template(root.fallback, out)

        if value is not None and value != "":
            out[root.name] = os.path.normpath(
                _expand_leading_tilde(value, base_env["HOME"])
            )

    return out


def _expand_leading_tilde(value: str, home: str) -> str:
    r"""Expand a leading ``~``, ``~/``, or ``~\`` against ``home``."""
    if value == "~":
        return home
    if value.startswith(("~/", "~\\")):
        return os.path.join(home, value[2:])
    return value


# ---------------------------------------------------------------------------
# Internal: template resolution
# ---------------------------------------------------------------------------

_TEMPLATE_VAR = re.compile(r"\$\{([^}]+)\}")


def _resolve_template(template: str, env: dict[str, str]) -> str | None:
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
    absolute_only: bool = False,
) -> str | None:
    """Search PATH for the first matching executable. With ``absolute_only``,
    relative PATH entries are ignored."""
    if not executables:
        return None

    path_value = env.get("PATH", "")
    delimiter = ";" if sys.platform == "win32" else os.pathsep
    path_parts = [
        p
        for p in path_value.split(delimiter)
        if p and (not absolute_only or os.path.isabs(p))
    ]

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
