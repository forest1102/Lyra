use lyra_core::Database;
use lyra_mcp::McpServer;

#[test]
fn lists_the_add_task_tool_with_a_closed_input_schema() {
    let db = Database::open_in_memory().unwrap();
    let server = McpServer::new(db);
    let response = server.handle(serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    }));

    let tool = &response["result"]["tools"][0];
    assert_eq!(tool["name"], "add_task");
    assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    assert_eq!(
        tool["inputSchema"]["properties"]["estimatedPomodoros"]["maximum"],
        99
    );
}

#[test]
fn add_task_returns_structured_content_and_persists_the_task() {
    let db = Database::open_in_memory().unwrap();
    let server = McpServer::new(db);
    let response = server.handle(serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "add_task",
            "arguments": {
                "title": "Write OSC tests",
                "list": "today",
                "estimatedPomodoros": 2
            }
        }
    }));

    assert_eq!(response["result"]["isError"], false);
    assert_eq!(
        response["result"]["structuredContent"]["task"]["title"],
        "Write OSC tests"
    );
    assert_eq!(server.database().list_tasks(None).unwrap().len(), 1);
}

#[test]
fn invalid_tool_arguments_are_returned_as_tool_errors() {
    let db = Database::open_in_memory().unwrap();
    let server = McpServer::new(db);
    let response = server.handle(serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "add_task",
            "arguments": { "title": "", "list": "today", "estimatedPomodoros": 100 }
        }
    }));
    assert_eq!(response["result"]["isError"], true);
}
