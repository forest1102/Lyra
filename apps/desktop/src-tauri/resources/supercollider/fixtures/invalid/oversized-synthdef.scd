(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0|
    var env = EnvGen.kr(Env.asr, gate, doneAction: Done.freeSelf);
    var sig = Mix.ar([SinOsc.ar(110), SinOsc.ar(111), SinOsc.ar(112), SinOsc.ar(113)]);
    // The Stage 3 fixture generator expands this voice graph until asBytes exceeds 64 KiB.
    Out.ar(out, Pan2.ar(sig, pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pseq([1], inf), \amp, 0.08)
);
)
