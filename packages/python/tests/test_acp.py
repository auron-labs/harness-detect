"""ACP metadata round trips and public getters using a shared synthetic registry."""

import json
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

import harness_detect as hd


def test_acp_missing():
    raw = hd.get_raw_harness_data()
    assert hd.list_harness_acp() == [
        hd.HarnessAcpRecord(h.key, h.name, h.acp or hd.HarnessAcp())
        for h in raw.harnesses
    ]
    for h in raw.harnesses:
        assert hd.get_harness_acp(h.key).acp == (h.acp or hd.HarnessAcp())
    assert hd.get_harness_acp(" OPENAI/CODEX ").key == "codex"
    with pytest.raises(hd.HarnessError, match="Unknown harness: absent"):
        hd.get_harness_acp("absent")


def test_acp_synthetic_public_flows(monkeypatch, tmp_path):
    fixture = json.loads(
        (Path(__file__).parents[3] / "testdata/acp-registry.json").read_text()
    )
    matrix = hd.HarnessMatrix(
        fixture["version"],
        tuple(hd.HarnessDefinition.from_dict(h) for h in fixture["harnesses"]),
    )
    monkeypatch.setattr(hd, "_MATRIX", matrix)
    assert hd.get_raw_harness_data() == matrix
    native = hd.get_harness_acp(" NATIVE-ALIAS ")
    assert native.key == "native"
    assert native.acp.launch.args == ("--acp", "two words", "")
    assert native.acp.launch.platforms == ("linux", "darwin")
    host = hd.get_harness_acp("host")
    bridge = hd.get_harness_acp(host.acp.adapter)
    assert bridge.acp.launch.command == "example-bridge"
    assert bridge.acp.launch.args == ()
    assert hd.get_harness_acp("missing").acp == hd.HarnessAcp()
    assert hd.get_harness_acp("unknown").acp == hd.HarnessAcp()
    assert hd.get_harness_acp("unsupported").acp.status == "unsupported"
    assert len(hd.list_harness_acp()) == len(matrix.harnesses)
    for h in hd.list_harnesses():
        result = hd.check_harness(
            h.key, hd.CheckOptions(env={"HOME": str(tmp_path), "PATH": ""})
        )
        assert result.installed is False, "ACP is not installation evidence"
        assert result.harness == h
    assert not hasattr(hd.get_harness_support("native"), "acp")
    with pytest.raises(FrozenInstanceError):
        native.acp.status = "mutated"
    with pytest.raises(FrozenInstanceError):
        native.acp.launch.command = "mutated"
    with pytest.raises(AttributeError):
        native.acp.launch.args.append("mutated")
    listed = hd.list_harness_acp()
    listed.clear()
    assert hd.get_raw_harness_data() == matrix
    assert len(hd.list_harness_acp()) == len(matrix.harnesses)
