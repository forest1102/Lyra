use lyra_core::{AddTask, Database, TaskList};
use serde::Deserialize;
use serde_json::{json, Value};

pub struct McpServer {
    database: Database,
}

impl McpServer {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn database(&self) -> &Database {
        &self.database
    }

    pub fn handle(&self, request: Value) -> Value {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let Some(method) = request.get("method").and_then(Value::as_str) else {
            return rpc_error(id, -32600, "invalid JSON-RPC request");
        };
        match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "lyra-mcp", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "LyraのローカルToday/Backlogへタスクを追加します。"
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "notifications/initialized" | "notifications/cancelled" => Value::Null,
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [{
                        "name": "add_task",
                        "title": "Add Lyra task",
                        "description": "LyraのTodayまたはBacklogへタスクを追加する",
                        "inputSchema": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["title", "list"],
                            "properties": {
                                "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                                "list": { "type": "string", "enum": ["today", "backlog"] },
                                "estimatedPomodoros": { "type": "integer", "minimum": 1, "maximum": 99 }
                            }
                        },
                        "annotations": {
                            "readOnlyHint": false,
                            "destructiveHint": false,
                            "idempotentHint": false,
                            "openWorldHint": false
                        }
                    }]
                }
            }),
            "tools/call" => self.call_tool(id, request.pointer("/params")),
            _ => rpc_error(id, -32601, &format!("method not found: {method}")),
        }
    }

    fn call_tool(&self, id: Value, params: Option<&Value>) -> Value {
        let Some(params) = params else {
            return rpc_error(id, -32602, "missing tool parameters");
        };
        if params.get("name").and_then(Value::as_str) != Some("add_task") {
            return tool_error(id, "unknown tool");
        }
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let input: AddTaskArguments = match serde_json::from_value(arguments) {
            Ok(input) => input,
            Err(error) => return tool_error(id, &format!("invalid arguments: {error}")),
        };
        match self.database.add_task(AddTask {
            title: input.title,
            list: input.list,
            estimated_pomodoros: input.estimated_pomodoros,
        }) {
            Ok(task) => {
                let text = serde_json::to_string(&task).unwrap_or_else(|_| "task added".into());
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": text }],
                        "structuredContent": { "task": task },
                        "isError": false
                    }
                })
            }
            Err(error) => tool_error(id, &error.to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddTaskArguments {
    title: String,
    list: TaskList,
    estimated_pomodoros: Option<i64>,
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

fn tool_error(id: Value, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }
    })
}
