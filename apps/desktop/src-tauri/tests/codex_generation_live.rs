use lyra_desktop::music::codex_client::{resolve_codex_binary, CodexClient, GenerationControls};
use lyra_desktop::music::generation::GenerationService;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[test]
#[ignore = "Codex認証とネットワーク接続が必要"]
fn codex_generates_a_valid_chuck_draft() {
    let directory = tempfile::tempdir().unwrap();
    let client = CodexClient::start(
        resolve_codex_binary(),
        directory.path().join("generation"),
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap();
    let mut service = GenerationService::new(client);

    let draft = service
        .generate(
            GenerationControls {
                theme: "deep-space".into(),
                arrangement: "ambient".into(),
                brightness: "medium".into(),
                density: "medium".into(),
                motion: "low".into(),
            },
            false,
        )
        .unwrap();

    assert!(!draft.title.is_empty());
    assert!(draft.chuck_source.contains("Math.srandom(__LYRA_SEED__);"));
    assert_eq!(draft.audio_validation, "pending");
}
