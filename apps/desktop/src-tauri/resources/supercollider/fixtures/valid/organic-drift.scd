(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=180|
    var env = EnvGen.kr(Env.asr(1.5, 1, 4), gate, doneAction: Done.freeSelf);
    var sig = VarSaw.ar(freq, LFNoise1.kr(0.1), 0.45);
    Out.ar(out, Pan2.ar(RLPF.ar(sig, 1400, 0.3), pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pbrown(2, 7, 1, inf), \degree, Pxrand([0, 2, 4, 7], inf), \amp, 0.06)
);
)
