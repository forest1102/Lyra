use lyra_desktop::music::codex_client::{
    generation_output_schema, GenerationControls, GenerationPrompt, JsonRpcBuilder, TURN_TIMEOUT,
};
use lyra_desktop::music::source_policy::SourcePolicy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[test]
fn thread_start_is_read_only_offline_and_never_requests_approval() {
    let request = JsonRpcBuilder::thread_start(7, "/tmp/lyra-generation");
    assert_eq!(request["method"], "thread/start");
    assert!(request.get("jsonrpc").is_none());
    assert_eq!(request["params"]["model"], "gpt-5.6-terra");
    assert_eq!(request["params"]["approvalPolicy"], "never");
    assert_eq!(request["params"]["sandbox"], "read-only");
    assert!(request["params"].get("sandboxPolicy").is_none());
    assert!(request["params"]["developerInstructions"]
        .as_str()
        .unwrap()
        .contains("ツールを使用せず"));
}

#[test]
fn generation_turn_has_a_bounded_wait() {
    assert!(TURN_TIMEOUT.as_secs() >= 60);
    assert!(TURN_TIMEOUT.as_secs() <= 120);
}

#[cfg(unix)]
#[test]
fn a_running_generation_can_be_cancelled_promptly() {
    use lyra_desktop::music::codex_client::{CodexClient, CodexClientError};
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    let directory = tempfile::tempdir().unwrap();
    let server = directory.path().join("fake-codex");
    std::fs::write(
        &server,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) echo '{"id":1,"result":{}}' ;;
    *'"method":"thread/start"'*) echo '{"id":2,"result":{"thread":{"id":"thread-1"}}}' ;;
    *'"method":"turn/start"'*) echo '{"id":3,"result":{"turn":{"id":"turn-1"}}}' ;;
  esac
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&server, std::fs::Permissions::from_mode(0o755)).unwrap();
    let cancellation = Arc::new(AtomicBool::new(false));
    let mut client = CodexClient::start(
        &server,
        directory.path().join("generation"),
        cancellation.clone(),
    )
    .unwrap();
    let prompt = GenerationPrompt::new(GenerationControls {
        theme: "deep-space".into(),
        arrangement: "ambient".into(),
        brightness: "medium".into(),
        density: "medium".into(),
        motion: "low".into(),
    });
    let started = Instant::now();
    let generation = std::thread::spawn(move || client.generate(&prompt));

    std::thread::sleep(Duration::from_millis(50));
    cancellation.store(true, Ordering::Release);
    let error = generation.join().unwrap().unwrap_err();

    assert!(matches!(error, CodexClientError::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(1));
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
    assert_eq!(request["params"]["effort"], "low");
}

#[test]
fn output_schema_is_closed_and_versioned() {
    let schema = generation_output_schema();
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["properties"]["schemaVersion"]["const"], 1);
    assert_eq!(schema["properties"]["bpm"]["minimum"], 40);
    assert_eq!(schema["properties"]["bpm"]["maximum"], 120);
    assert!(schema["properties"].get("chuckSource").is_some());
    assert!(schema["properties"].get("supercolliderSource").is_none());
    assert_eq!(schema["required"].as_array().unwrap().len(), 6);
}

#[test]
fn generation_prompt_is_compact_and_orders_controls_contract_recipes_quality_then_example() {
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
    assert!(text.contains("__LYRA_SEED__"));
    assert!(text.contains("FileIO"));
    assert!(text.contains("JSON"));
    let sections = [
        "1. 選択値",
        "2. 静的検証必須契約",
        "3. 選択された音楽レシピ",
        "4. 音響品質",
        "5. 検証済みChucK例",
    ];
    let mut previous = 0;
    for section in sections {
        let position = text
            .find(section)
            .unwrap_or_else(|| panic!("missing prompt section: {section}"));
        assert!(
            position >= previous,
            "prompt section is out of order: {section}"
        );
        previous = position;
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
        "1〜4個",
        "1〜10000ms",
        "ちょうど1回",
        "外部I/O",
    ] {
        assert!(
            text.contains(contract),
            "missing quality contract: {contract}"
        );
    }

    for allowed_class in [
        "Math", "Std", "SinOsc", "TriOsc", "SawOsc", "PulseOsc", "Blit", "Noise", "CNoise", "ADSR",
        "Envelope", "LPF", "HPF", "BPF", "BRF", "ResonZ", "DelayL", "Echo", "JCRev", "NRev",
        "Chorus", "Pan2", "Gain", "Dyno",
    ] {
        assert!(
            text.contains(allowed_class),
            "missing allowlisted class: {allowed_class}"
        );
    }
}

#[test]
fn generation_prompt_stays_within_six_kib_for_every_valid_control_combination() {
    let themes = [
        "deep-space",
        "rainy-cabin",
        "minimal-pulse",
        "organic-drift",
    ];
    let arrangements = ["ambient", "lofi", "minimal-melody"];
    let levels = ["low", "medium", "high"];
    let mut cases = 0;

    for theme in themes {
        for arrangement in arrangements {
            for brightness in levels {
                for density in levels {
                    for motion in levels {
                        let text = GenerationPrompt::new(GenerationControls {
                            theme: theme.into(),
                            arrangement: arrangement.into(),
                            brightness: brightness.into(),
                            density: density.into(),
                            motion: motion.into(),
                        })
                        .to_string();
                        assert!(
                            text.len() <= 6 * 1024,
                            "prompt is {} bytes for {theme}/{arrangement}/{brightness}/{density}/{motion}",
                            text.len()
                        );
                        cases += 1;
                    }
                }
            }
        }
    }

    assert_eq!(cases, 4 * 3 * 3 * 3 * 3);
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
            "中高域のSinOsc/TriOsc",
            [
                "小音量のNoise",
                "丸めたPulseOsc/SinOsc",
                "遅いSawOsc/SinOsc変調",
            ],
        ),
        (
            "rainy-cabin",
            "小音量のNoise",
            [
                "中高域のSinOsc/TriOsc",
                "丸めたPulseOsc/SinOsc",
                "遅いSawOsc/SinOsc変調",
            ],
        ),
        (
            "minimal-pulse",
            "丸めたPulseOsc/SinOsc",
            [
                "中高域のSinOsc/TriOsc",
                "小音量のNoise",
                "遅いSawOsc/SinOsc変調",
            ],
        ),
        (
            "organic-drift",
            "遅いSawOsc/SinOsc変調",
            [
                "中高域のSinOsc/TriOsc",
                "小音量のNoise",
                "丸めたPulseOsc/SinOsc",
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
        .split_once("```chuck\n")
        .and_then(|(_, rest)| rest.split_once("\n```").map(|(source, _)| source))
        .expect("prompt must include a ChucK structure example");

    let validation = SourcePolicy::v1().validate(source).unwrap();
    assert_eq!(validation.voice_count, 2);
    assert!(source.contains("0.05 => texture.gain;"));
    assert!(source.contains("0.05 => lead.gain;"));
    assert!(source.contains("1.0 => master.gain;"));
    assert!(source.contains("spork ~ textureVoice();"));
    let spork = source.find("spork ~ textureVoice();").unwrap();
    assert!(source[..spork].contains("while (true)"));
    assert!(source[spork..].contains("while (true)"));
}

#[test]
fn repair_prompt_uses_thread_history_and_only_sends_diagnostics_and_fix_conditions() {
    let prompt = GenerationPrompt::new(GenerationControls {
        theme: "rainy-cabin".into(),
        arrangement: "lofi".into(),
        brightness: "medium".into(),
        density: "low".into(),
        motion: "low".into(),
    });
    let repair = prompt.repair("forbidden selector: .play");
    assert!(repair.contains("forbidden selector: .play"));
    assert!(repair.contains("修正版JSONだけ"));
    assert!(repair.contains("同じスレッド"));
    assert!(!repair.contains("rainy-cabin"));
    assert!(!repair.contains("arrangement=lofi"));
    assert!(!repair.contains("柔らかいコード反復"));
    assert!(!repair.contains("小音量のNoise"));
    assert!(!repair.contains("Lyra向けの長時間作業用BGM"));
    assert!(
        repair.len() < 512,
        "repair prompt is {} bytes",
        repair.len()
    );
}
