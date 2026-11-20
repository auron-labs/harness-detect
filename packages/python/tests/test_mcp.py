from __future__ import annotations

import json

import pytest

from harness_detect import (
    HarnessError,
    McpSkippedServer,
    get_harness_mcp,
    get_harness_support,
    list_harness_mcp,
    list_harnesses,
    translate_mcp_json,
)


def test_mcp_metadata_is_exposed() -> None:
    record = get_harness_mcp(" Claude ")
    assert record.key == "claude-code"
    assert record.mcp.mcp_json == "supported"
    assert len(list_harness_mcp()) == len(list_harnesses())
    with pytest.raises(HarnessError, match="Unknown harness: not-a-harness"):
        get_harness_mcp("not-a-harness")
    support = get_harness_support("codex").support
    assert support.agents_skills.local.status == "supported"


def test_translate_mcp_json() -> None:
    document = {
        "mcpServers": {
            "fs": {"command": "npx", "args": ["-y", "fs"]},
            "legacy": {"type": "sse", "url": "https://example.com/sse"},
        }
    }
    translation = translate_mcp_json("codex", json.dumps(document), scope="global")
    assert translation.format == "toml"
    assert translation.config == {
        "mcp_servers": {"fs": {"command": "npx", "args": ["-y", "fs"]}}
    }
    assert translation.skipped == [
        McpSkippedServer("legacy", "unsupported transport: sse")
    ]

    with pytest.raises(HarnessError, match="no file-based MCP config for scope local"):
        translate_mcp_json("aider", {"mcpServers": {}})
    with pytest.raises(HarnessError, match="must be an object with an mcpServers"):
        translate_mcp_json("codex", {"servers": {}})
    with pytest.raises(HarnessError, match="Unknown MCP scope: project"):
        translate_mcp_json("codex", {"mcpServers": {}}, scope="project")
