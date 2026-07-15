use lyra_desktop::music::codex_client::{
    generation_output_schema, GenerationControls, GenerationPrompt, JsonRpcBuilder,
};
use lyra_desktop::music::source_policy::SourcePolicy;

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
        arrangement: "ambient".into(),
        brightness: "low".into(),
        density: "medium".into(),
        motion: "high".into(),
    });
    let text = prompt.to_string();
    assert!(text.contains("deep-space"));
    assert!(text.contains("arrangement=ambient"));
    assert!(text.contains("brightness=low"));
    assert!(text.contains("\\lyra_voice_1"));
    assert!(text.contains("Pfunc"));
    assert!(text.contains("JSON"));
    for section in [
        "1. 絶対条件",
        "2. コントロール変換表",
        "3. 曲調別レシピ",
        "4. テーマ別レシピ",
        "5. 音響・知覚設計",
        "6. SuperColliderコード契約",
        "7. 出力前セルフチェック",
    ] {
        assert!(text.contains(section), "missing prompt section: {section}");
    }
    for contract in [
        "MIDI 55〜79",
        "MIDI 48以上",
        "0.04〜0.09",
        "0.10〜0.16",
        "0.03 / 0.1 / 0.3 Hz",
        "±6%",
        "±12%",
        "30〜200 Hz",
        "attackは最低0.01秒",
        "releaseは最低0.3秒",
        "HPF 120〜250 Hz",
        "LPF 4〜8 kHz",
        "8〜32イベント",
    ] {
        assert!(
            text.contains(contract),
            "missing quality contract: {contract}"
        );
    }
}

fn prompt_text(theme: &str, arrangement: &str) -> String {
    GenerationPrompt::new(GenerationControls {
        theme: theme.into(),
        arrangement: arrangement.into(),
        brightness: "medium".into(),
        density: "medium".into(),
        motion: "low".into(),
    })
    .to_string()
}

#[test]
fn generation_prompt_includes_only_the_selected_arrangement_recipe() {
    for (arrangement, selected, excluded) in [
        (
            "ambient",
            "2〜8拍の協和パッド",
            ["重低音キック", "3〜7音のメジャー・ペンタトニック動機"],
        ),
        (
            "lofi",
            "柔らかいコード反復",
            ["2〜8拍の協和パッド", "3〜7音のメジャー・ペンタトニック動機"],
        ),
        (
            "minimal-melody",
            "3〜7音のメジャー・ペンタトニック動機",
            ["2〜8拍の協和パッド", "重低音キック"],
        ),
    ] {
        let text = prompt_text("deep-space", arrangement);
        assert!(text.contains(selected));
        for marker in excluded {
            assert!(!text.contains(marker), "unexpected recipe marker: {marker}");
        }
    }
}

#[test]
fn generation_prompt_includes_only_the_selected_theme_recipe() {
    for (theme, selected, excluded) in [
        (
            "deep-space",
            "中高域のSinOsc/LFTri",
            [
                "小音量のPinkNoise",
                "丸めたPulse/SinOsc",
                "遅いVarSaw/SinOsc変調",
            ],
        ),
        (
            "rainy-cabin",
            "小音量のPinkNoise",
            [
                "中高域のSinOsc/LFTri",
                "丸めたPulse/SinOsc",
                "遅いVarSaw/SinOsc変調",
            ],
        ),
        (
            "minimal-pulse",
            "丸めたPulse/SinOsc",
            [
                "中高域のSinOsc/LFTri",
                "小音量のPinkNoise",
                "遅いVarSaw/SinOsc変調",
            ],
        ),
        (
            "organic-drift",
            "遅いVarSaw/SinOsc変調",
            [
                "中高域のSinOsc/LFTri",
                "小音量のPinkNoise",
                "丸めたPulse/SinOsc",
            ],
        ),
    ] {
        let text = prompt_text(theme, "ambient");
        assert!(text.contains(selected));
        for marker in excluded {
            assert!(!text.contains(marker), "unexpected recipe marker: {marker}");
        }
    }
}

#[test]
fn generation_prompt_provides_a_source_policy_compliant_structure_example() {
    let text = prompt_text("deep-space", "ambient");
    let source = text
        .split_once("```supercollider\n")
        .and_then(|(_, rest)| rest.split_once("\n```").map(|(source, _)| source))
        .expect("prompt must include a SuperCollider structure example");

    SourcePolicy::v1().validate(source).unwrap();
}

#[test]
fn repair_prompt_preserves_the_original_controls_and_adds_diagnostics() {
    let prompt = GenerationPrompt::new(GenerationControls {
        theme: "rainy-cabin".into(),
        arrangement: "lofi".into(),
        brightness: "medium".into(),
        density: "low".into(),
        motion: "low".into(),
    });
    let repair = prompt.repair("forbidden selector: .play");
    assert!(repair.contains("rainy-cabin"));
    assert!(repair.contains("arrangement=lofi"));
    assert!(repair.contains("5. 音響・知覚設計"));
    assert!(repair.contains("柔らかいコード反復"));
    assert!(repair.contains("小音量のPinkNoise"));
    assert!(!repair.contains("2〜8拍の協和パッド"));
    assert!(repair.contains("forbidden selector: .play"));
    assert!(repair.contains("修正版JSONだけ"));
}
