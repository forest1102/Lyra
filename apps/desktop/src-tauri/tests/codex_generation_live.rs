use lyra_desktop::music::codex_client::{resolve_codex_binary, CodexClient, GenerationControls};
use lyra_desktop::music::generation::GenerationService;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

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
    let cases = [
        ("deep-space", "ambient", "medium", "medium", "low"),
        ("rainy-cabin", "lofi", "medium", "low", "medium"),
        ("minimal-pulse", "minimal-melody", "high", "medium", "high"),
    ];
    let mut elapsed_seconds = Vec::with_capacity(cases.len());

    for (theme, arrangement, brightness, density, motion) in cases {
        let started = Instant::now();
        let draft = service
            .generate(
                GenerationControls {
                    theme: theme.into(),
                    arrangement: arrangement.into(),
                    brightness: brightness.into(),
                    density: density.into(),
                    motion: motion.into(),
                },
                false,
            )
            .unwrap();
        let elapsed = started.elapsed().as_secs_f64();
        eprintln!("codex_generation_live theme={theme} elapsed_seconds={elapsed:.3}");
        elapsed_seconds.push(elapsed);

        assert!(!draft.title.is_empty());
        assert!(!draft.description.is_empty());
        assert!(!draft.chuck_source.is_empty());
        assert!(draft.chuck_source.contains("Math.srandom(__LYRA_SEED__);"));
        assert_eq!(draft.audio_validation, "pending");
    }

    elapsed_seconds.sort_by(f64::total_cmp);
    eprintln!(
        "codex_generation_live median_seconds={:.3}",
        elapsed_seconds[elapsed_seconds.len() / 2]
    );
}
