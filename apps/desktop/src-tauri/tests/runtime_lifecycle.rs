const BOOTSTRAP: &str = include_str!("../resources/supercollider/bootstrap.scd");

fn handler(start: &str, end: &str) -> &'static str {
    let start = BOOTSTRAP.find(start).expect("handler start must exist");
    let end = BOOTSTRAP[start..]
        .find(end)
        .map(|offset| start + offset)
        .expect("handler end must exist");
    &BOOTSTRAP[start..end]
}

#[test]
fn stop_mutes_and_frees_players_before_acknowledging() {
    let stop = handler("OSCdef(\\lyraStop", "OSCdef(\\lyraVolumeCommand");
    let mute = stop.find("\\lag, 0").expect("stop must mute immediately");
    let free = stop
        .find("tryPerform(\\stop)")
        .expect("stop must stop active players");
    let ack = stop.find("~lyraAck").expect("stop must acknowledge");

    assert!(mute < ack);
    assert!(free < ack);
    assert!(!stop.contains("SystemClock.sched"));
}

#[test]
fn runtime_shuts_itself_down_when_desktop_heartbeats_stop() {
    let ping = handler("OSCdef(\\lyraPing", "OSCdef(\\lyraLoad");

    assert!(BOOTSTRAP.contains("~lyraLastHeartbeat = Main.elapsedTime;"));
    assert!(ping.contains("~lyraLastHeartbeat = Main.elapsedTime;"));
    assert!(BOOTSTRAP.contains("Main.elapsedTime - ~lyraLastHeartbeat"));
    assert!(BOOTSTRAP.contains("~lyraShutdown.();"));
}
