(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=220|
    var env = EnvGen.kr(Env.asr(0.8, 1, 3), gate, doneAction: Done.freeSelf);
    var sig = LPF.ar(PinkNoise.ar(0.25), LFNoise1.kr(0.2) * 900 + 1600);
    Out.ar(out, Pan2.ar(sig, pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pwhite(2, 6, inf), \degree, Pseq([0, 2, 4, 1], inf), \amp, 0.06)
);
)
