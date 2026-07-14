use lyra_desktop::music::codex_client::{
    generation_output_schema, GenerationControls, GenerationPrompt, JsonRpcBuilder,
};

#[test]
fn thread_start_is_read_only_offline_and_never_requests_approval() {
    let request = JsonRpcBuilder::thread_start(7, "/tmp/lyra-generation");
    assert_eq!(request["method"], "thread/start");
    assert!(request.get("jsonrpc").is_none());
    assert_eq!(request["params"]["approvalPolicy"], "never");
    assert_eq!(request["params"]["sandbox"], "read-only");
    assert!(request["params"].get("sandboxPolicy").is_none());
}

#[test]
fn turn_start_uses_the_current_app_server_sandbox_policy() {
    let request = JsonRpcBuilder::turn_start(
        8,
        "thread-1",
        std::path::Path::new("/tmp/lyra-generation"),
        "曲を生成",
    );
    assert!(request.get("jsonrpc").is_none());
    assert_eq!(request["params"]["sandboxPolicy"]["type"], "readOnly");
    assert_eq!(request["params"]["sandboxPolicy"]["networkAccess"], false);
}

#[test]
fn output_schema_is_closed_and_versioned() {
    let schema = generation_output_schema();
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["properties"]["schemaVersion"]["const"], 1);
    assert_eq!(schema["properties"]["bpm"]["minimum"], 40);
    assert_eq!(schema["properties"]["bpm"]["maximum"], 120);
    assert_eq!(schema["required"].as_array().unwrap().len(), 6);
}

#[test]
fn generation_prompt_contains_theme_controls_and_code_contract() {
    let prompt = GenerationPrompt::new(GenerationControls {
        theme: "deep-space".into(),
        brightness: "low".into(),
        density: "medium".into(),
        motion: "high".into(),
    });
    let text = prompt.to_string();
    assert!(text.contains("deep-space"));
    assert!(text.contains("brightness=low"));
    assert!(text.contains("\\lyra_voice_1"));
    assert!(text.contains("Pfunc"));
    assert!(text.contains("JSON"));
}

#[test]
fn repair_prompt_preserves_the_original_controls_and_adds_diagnostics() {
    let prompt = GenerationPrompt::new(GenerationControls {
        theme: "rainy-cabin".into(),
        brightness: "medium".into(),
        density: "low".into(),
        motion: "low".into(),
    });
    let repair = prompt.repair("forbidden selector: .play");
    assert!(repair.contains("rainy-cabin"));
    assert!(repair.contains("forbidden selector: .play"));
    assert!(repair.contains("修正版JSONだけ"));
}
