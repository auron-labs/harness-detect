use harness_detect::{
    get_harness_mcp, get_harness_support, list_harness_mcp, list_harnesses, translate_mcp_json,
    McpSkippedServer, McpTranslateOptions,
};
use serde_json::json;

#[test]
fn mcp_metadata_is_exposed() {
    let record = get_harness_mcp(" Claude ").unwrap();
    assert_eq!(record.key, "claude-code");
    assert_eq!(record.mcp.mcp_json, "supported");
    assert_eq!(list_harness_mcp().len(), list_harnesses().len());
    assert_eq!(
        get_harness_mcp("not-a-harness").unwrap_err().0,
        "Unknown harness: not-a-harness"
    );
    assert_eq!(
        get_harness_support("codex")
            .unwrap()
            .support
            .agents_skills
            .local
            .status,
        "supported"
    );
}

#[test]
fn translates_mcp_json() {
    let document = json!({"mcpServers": {
        "fs": {"command": "npx", "args": ["-y", "fs"]},
        "legacy": {"type": "sse", "url": "https://example.com/sse"}
    }});
    let options = McpTranslateOptions {
        scope: Some("global".into()),
    };
    let translation = translate_mcp_json("codex", &document, &options).unwrap();
    assert_eq!(translation.format, "toml");
    assert_eq!(
        translation.config,
        json!({"mcp_servers": {"fs": {"command": "npx", "args": ["-y", "fs"]}}})
    );
    assert_eq!(
        translation.skipped,
        vec![McpSkippedServer {
            name: "legacy".into(),
            reason: "unsupported transport: sse".into()
        }]
    );

    let local = McpTranslateOptions::default();
    let error = translate_mcp_json("aider", &json!({"mcpServers": {}}), &local).unwrap_err();
    assert_eq!(
        error.0,
        "Harness aider has no file-based MCP config for scope local"
    );
    let error = translate_mcp_json("codex", &json!({"servers": {}}), &local).unwrap_err();
    assert_eq!(
        error.0,
        ".mcp.json must be an object with an mcpServers object"
    );
}
