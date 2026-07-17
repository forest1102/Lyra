use lyra_core::{AddTaskV2, Database, Recurrence, TaskList, TaskPriority, TaskStatus};
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
                                "estimatedPomodoros": { "type": "integer", "minimum": 1, "maximum": 99 },
                                "priority": { "type": "string", "enum": ["none", "low", "medium", "high"] },
                                "projectId": { "type": "string" },
                                "parentId": { "type": "string" },
                                "notes": { "type": "string" },
                                "plannedDate": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
                                "dueDate": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
                                "recurrence": { "type": "string", "enum": ["daily", "weekly", "monthly"] },
                                "tagIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true }
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
        let status = match input.list {
            TaskList::Today => TaskStatus::Active,
            TaskList::Backlog => TaskStatus::Inbox,
        };
        let planned_date = input.planned_date;
        match self.database.add_task_v2(AddTaskV2 {
            title: input.title,
            status,
            priority: input.priority,
            estimated_pomodoros: input.estimated_pomodoros,
            project_id: input.project_id,
            parent_id: input.parent_id,
            notes: input.notes,
            planned_date,
            due_date: input.due_date,
            recurrence: input.recurrence,
            tag_ids: input.tag_ids,
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
    #[serde(default)]
    priority: TaskPriority,
    project_id: Option<String>,
    parent_id: Option<String>,
    #[serde(default)]
    notes: String,
    planned_date: Option<String>,
    due_date: Option<String>,
    recurrence: Option<Recurrence>,
    #[serde(default)]
    tag_ids: Vec<String>,
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
