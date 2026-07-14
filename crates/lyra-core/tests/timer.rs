use lyra_core::{TimerAction, TimerEngine, TimerPhase, TimerPreset, TimerStatus};

fn preset() -> TimerPreset {
    TimerPreset {
        id: "standard".into(),
        name: "Standard".into(),
        focus_minutes: 25,
        short_break_minutes: 5,
        long_break_minutes: 15,
        cycles_before_long_break: 4,
        built_in: true,
    }
}

#[test]
fn focus_completion_waits_for_manual_break_start() {
    let engine = TimerEngine::new(preset());
    engine.dispatch(TimerAction::Start, 1_000).unwrap();
    let state = engine.dispatch(TimerAction::Tick, 1_501_000).unwrap();

    assert_eq!(state.status, TimerStatus::AwaitingBreak);
    assert_eq!(state.phase, TimerPhase::Focus);
    assert_eq!(state.remaining_seconds, 0);

    let state = engine.dispatch(TimerAction::StartBreak, 1_506_000).unwrap();
    assert_eq!(state.status, TimerStatus::Running);
    assert_eq!(state.phase, TimerPhase::ShortBreak);
    assert_eq!(state.remaining_seconds, 300);
}

#[test]
fn pause_and_resume_use_a_deadline_instead_of_tick_counting() {
    let engine = TimerEngine::new(preset());
    engine.dispatch(TimerAction::Start, 0).unwrap();
    let paused = engine.dispatch(TimerAction::Pause, 60_000).unwrap();
    assert_eq!(paused.remaining_seconds, 1_440);

    engine.dispatch(TimerAction::Resume, 120_000).unwrap();
    let resumed = engine.dispatch(TimerAction::Tick, 180_000).unwrap();
    assert_eq!(resumed.remaining_seconds, 1_380);
}

#[test]
fn timer_events_are_broadcast_to_subscribers() {
    let engine = TimerEngine::new(preset());
    let receiver = engine.subscribe();
    engine.dispatch(TimerAction::Start, 0).unwrap();

    let state = receiver.recv().unwrap();
    assert_eq!(state.status, TimerStatus::Running);
}

#[test]
fn a_new_focus_can_start_after_a_completed_break() {
    let engine = TimerEngine::new(preset());
    engine.dispatch(TimerAction::Start, 0).unwrap();
    engine.dispatch(TimerAction::Tick, 1_500_000).unwrap();
    engine.dispatch(TimerAction::StartBreak, 1_500_000).unwrap();
    let completed = engine.dispatch(TimerAction::Tick, 1_800_000).unwrap();
    assert_eq!(completed.status, TimerStatus::Completed);

    let next_focus = engine.dispatch(TimerAction::Start, 1_900_000).unwrap();
    assert_eq!(next_focus.phase, TimerPhase::Focus);
    assert_eq!(next_focus.status, TimerStatus::Running);
    assert_eq!(next_focus.remaining_seconds, 1_500);
}
