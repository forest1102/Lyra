var token = "LYRA_OSC_TOKEN".getenv;
var rustPort = "LYRA_RUST_PORT".getenv.asInteger;
var languagePort = "LYRA_SC_PORT".getenv.asInteger;
var pluginPath = "LYRA_PLUGIN_PATH".getenv;
var scsynthPath = "LYRA_SCSYNTH_PATH".getenv;

~lyraReply = NetAddr("127.0.0.1", rustPort);
~lyraTracks = IdentityDictionary.new;
~lyraDecks = Array.newClear(2);
~lyraActiveDeck = nil;
~lyraLastSwitchRequest = -1;
~lyraVolume = 0.8;

thisProcess.openUDPPort(languagePort);
Server.program = scsynthPath;
s = Server.local;
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.memSize = 65536;
s.options.maxNodes = 4096;
s.options.maxSynthDefs = 256;
s.options.numBuffers = 256;
s.options.loadDefs = false;
s.options.safetyClipThreshold = 1.0;
s.options.ugenPluginsPath = pluginPath;

~lyraAck = { |requestId, command|
  ~lyraReply.sendMsg("/lyra/v1/ack", token, requestId, command);
};

~lyraError = { |requestId, code, message|
  ~lyraReply.sendMsg("/lyra/v1/error", token, requestId, code, message.asString);
};

~lyraAuthorized = { |message|
  message.size > 2 and: { message[1].asString == token };
};

~lyraStartDeck = { |deckIndex, trackId, seed|
  var deck = ~lyraDecks[deckIndex];
  var track = ~lyraTracks[trackId.asSymbol];
  if(track.isNil) { Error("track is not loaded").throw };
  deck[\player].tryPerform(\stop);
  deck[\group].freeAll;
  track[\synthDefs].do(_.add);
  s.sync;
  deck[\clock].tempo = (track[\bpm] ? 60) / 60;
  deck[\player] = Pseed(
    seed,
    Pbindf(track[\pattern], \out, deck[\bus].index, \group, deck[\group])
  ).play(deck[\clock]);
};

~lyraSwitch = { |requestId, trackId, seed|
  var standby;
  var old;
  if(requestId < ~lyraLastSwitchRequest) { nil } {
    ~lyraLastSwitchRequest = requestId;
    standby = if(~lyraActiveDeck == 0) { 1 } { 0 };
    old = ~lyraActiveDeck;
    Routine({
      try {
        ~lyraStartDeck.(standby, trackId, seed);
        0.1.wait;
        if(requestId == ~lyraLastSwitchRequest) {
          ~lyraMixer.set(
            \gainA, if(standby == 0) { ~lyraVolume } { 0 },
            \gainB, if(standby == 1) { ~lyraVolume } { 0 },
            \lag, 2
          );
          ~lyraActiveDeck = standby;
          ~lyraReply.sendMsg("/lyra/v1/state", token, requestId, "playing", trackId, seed);
          2.1.wait;
          if(old.notNil and: { old != standby }) {
            ~lyraDecks[old][\player].tryPerform(\stop);
            ~lyraDecks[old][\group].freeAll;
          };
        };
      } { |error|
        error.reportError;
        ~lyraError.(requestId, "switch_failed", error.asString);
      };
    }).play(SystemClock);
  };
};

SynthDef(\lyra_trusted_mixer, { |busA=0, busB=2, gainA=0, gainB=0, lag=2, out=0|
  var a = In.ar(busA, 2) * Lag.kr(gainA, lag);
  var b = In.ar(busB, 2) * Lag.kr(gainB, lag);
  Out.ar(out, Limiter.ar(LeakDC.ar(a + b), 0.8));
}).add;

s.waitForBoot({
  var root = Group.head(s);
  2.do({ |index|
    ~lyraDecks[index] = (
      group: Group.head(root),
      bus: Bus.audio(s, 2),
      clock: TempoClock.new(1),
      player: nil
    );
  });
  ~lyraValidationGroup = Group.tail(root);
  ~lyraValidationBus = Bus.audio(s, 2);
  ~lyraMixer = Synth.tail(root, \lyra_trusted_mixer, [
    \busA, ~lyraDecks[0][\bus].index,
    \busB, ~lyraDecks[1][\bus].index
  ]);
  ~lyraReply.sendMsg("/lyra/v1/ready", token, languagePort);
  ("LYRA_READY:" ++ languagePort).postln;
});

OSCdef(\lyraPing, { |message|
  if(~lyraAuthorized.(message)) { ~lyraAck.(message[2].asInteger, "ping") };
}, "/lyra/v1/ping", recvPort: languagePort);

OSCdef(\lyraLoad, { |message|
  var requestId = message[2].asInteger;
  var trackId = message[3].asString;
  var path = message[4].asString;
  if(~lyraAuthorized.(message)) {
    try {
      File.readAllString(path).interpret;
      ~lyraTrack[\bpm] = message[5].asFloat;
      ~lyraTracks[trackId.asSymbol] = ~lyraTrack;
      ~lyraTrack = nil;
      ~lyraReply.sendMsg("/lyra/v1/loaded", token, requestId, trackId);
    } { |error|
      error.reportError;
      ~lyraError.(requestId, "load_failed", error.asString);
    };
  };
}, "/lyra/v1/load", recvPort: languagePort);

OSCdef(\lyraPlay, { |message|
  if(~lyraAuthorized.(message)) {
    ~lyraSwitch.(message[2].asInteger, message[3].asString, message[4].asInteger);
  };
}, "/lyra/v1/play", recvPort: languagePort);

OSCdef(\lyraSwitchCommand, { |message|
  if(~lyraAuthorized.(message)) {
    ~lyraSwitch.(message[2].asInteger, message[3].asString, message[4].asInteger);
  };
}, "/lyra/v1/switch", recvPort: languagePort);

OSCdef(\lyraPause, { |message|
  var requestId = message[2].asInteger;
  if(~lyraAuthorized.(message) and: { ~lyraActiveDeck.notNil }) {
    ~lyraMixer.set(\gainA, 0, \gainB, 0, \lag, 0.25);
    ~lyraDecks[~lyraActiveDeck][\group].set(\gate, 0);
    SystemClock.sched(0.25, { ~lyraDecks[~lyraActiveDeck][\player].pause; nil });
    ~lyraAck.(requestId, "pause");
  };
}, "/lyra/v1/pause", recvPort: languagePort);

OSCdef(\lyraResume, { |message|
  var requestId = message[2].asInteger;
  if(~lyraAuthorized.(message) and: { ~lyraActiveDeck.notNil }) {
    ~lyraDecks[~lyraActiveDeck][\player].resume;
    ~lyraMixer.set(
      \gainA, if(~lyraActiveDeck == 0) { ~lyraVolume } { 0 },
      \gainB, if(~lyraActiveDeck == 1) { ~lyraVolume } { 0 },
      \lag, 0.25
    );
    ~lyraAck.(requestId, "resume");
  };
}, "/lyra/v1/resume", recvPort: languagePort);

OSCdef(\lyraStop, { |message|
  var requestId = message[2].asInteger;
  if(~lyraAuthorized.(message)) {
    ~lyraMixer.set(\gainA, 0, \gainB, 0, \lag, 2);
    SystemClock.sched(2, {
      ~lyraDecks.do({ |deck| deck[\player].tryPerform(\stop); deck[\group].freeAll });
      ~lyraActiveDeck = nil;
      nil;
    });
    ~lyraAck.(requestId, "stop");
  };
}, "/lyra/v1/stop", recvPort: languagePort);

OSCdef(\lyraVolumeCommand, { |message|
  if(~lyraAuthorized.(message)) {
    ~lyraVolume = message[3].asFloat.clip(0, 1);
    ~lyraAck.(message[2].asInteger, "volume");
  };
}, "/lyra/v1/volume", recvPort: languagePort);

OSCdef(\lyraShutdown, { |message|
  if(~lyraAuthorized.(message)) {
    ~lyraAck.(message[2].asInteger, "shutdown");
    s.quit;
    0.exit;
  };
}, "/lyra/v1/shutdown", recvPort: languagePort);

SystemClock.sched(1, {
  if(s.serverRunning) {
    ~lyraReply.sendMsg(
      "/lyra/v1/metrics", token, s.avgCPU, s.peakCPU,
      s.numSynths, s.numGroups
    );
  };
  1;
});
