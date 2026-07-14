(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=220|
    var env = EnvGen.kr(Env.asr(0.01, 1, 0.4), gate, doneAction: Done.freeSelf);
    var sig = Pulse.ar(freq, 0.25);
    Out.ar(out, Pan2.ar(LPF.ar(sig, 1200), pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pseq([0.5, 1, 0.5, 2], inf), \degree, Pseq([0, 0, 3, 5], inf), \amp, 0.05)
);
)
