use lyra_desktop::music::osc_protocol::{decode_message, encode_message, OscArgument, OscMessage};
use lyra_desktop::music::runtime::{PlaybackCoordinator, RecoveryAction, SwitchDecision};

#[test]
fn osc_v1_round_trips_authenticated_requests() {
    let message = OscMessage {
        address: "/lyra/v1/switch".into(),
        arguments: vec![
            OscArgument::String("0123456789abcdef".into()),
            OscArgument::Int64(42),
            OscArgument::String("track-1".into()),
            OscArgument::Int64(84),
        ],
    };
    let encoded = encode_message(&message);
    let decoded = decode_message(&encoded).unwrap();
    assert_eq!(decoded, message);
}

#[test]
fn rapid_switching_accepts_only_the_latest_response() {
    let mut coordinator = PlaybackCoordinator::new();
    for request_id in 1..=10 {
        assert!(matches!(
            coordinator.request_switch(request_id, format!("track-{request_id}"), request_id * 10),
            SwitchDecision::Accepted { .. }
        ));
    }

    assert!(!coordinator.confirm_switch(3));
    assert!(coordinator.confirm_switch(10));
    let active = coordinator.active().unwrap();
    assert_eq!(active.track_id, "track-10");
    assert_eq!(active.seed, 100);
}

#[test]
fn a_second_runtime_failure_within_five_minutes_disables_only_music() {
    let mut coordinator = PlaybackCoordinator::new();
    coordinator.request_switch(1, "track-1".into(), 42);
    coordinator.confirm_switch(1);

    assert_eq!(
        coordinator.register_runtime_failure(1_000),
        RecoveryAction::RestartOnce {
            track_id: "track-1".into(),
            seed: 42
        }
    );
    assert_eq!(
        coordinator.register_runtime_failure(299_000),
        RecoveryAction::DisableMusicForSession
    );
    assert!(coordinator.music_disabled());
}

#[test]
fn a_stale_switch_request_is_ignored() {
    let mut coordinator = PlaybackCoordinator::new();
    coordinator.request_switch(7, "new".into(), 1);
    assert_eq!(
        coordinator.request_switch(6, "old".into(), 2),
        SwitchDecision::IgnoredStale
    );
}

#[test]
fn stopping_clears_the_track_used_for_runtime_recovery() {
    let mut coordinator = PlaybackCoordinator::new();
    coordinator.request_switch(1, "track-1".into(), 42);
    coordinator.confirm_switch(1);

    coordinator.clear_playback();

    assert!(coordinator.active().is_none());
    assert_eq!(
        coordinator.register_runtime_failure(1_000),
        RecoveryAction::RestartIdleRuntime
    );
}
