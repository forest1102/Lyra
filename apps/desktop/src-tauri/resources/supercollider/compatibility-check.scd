Server.program = "LYRA_SCSYNTH_PATH".getenv;
s = Server.local;
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.waitForBoot({
  SynthDef(\lyra_compatibility_tone, {
    var env = EnvGen.kr(Env.perc(0.01, 2), doneAction: Done.freeSelf);
    Out.ar(0, Pan2.ar(SinOsc.ar(440) * 0.05 * env));
  }).add;
  s.sync;
  Synth(\lyra_compatibility_tone);
  SystemClock.sched(2.2, {
    "LYRA_SC_COMPATIBILITY_OK".postln;
    s.quit;
    0.exit;
    nil;
  });
});
SystemClock.sched(10, {
  "LYRA_SC_COMPATIBILITY_TIMEOUT".postln;
  s.quit;
  1.exit;
  nil;
});
