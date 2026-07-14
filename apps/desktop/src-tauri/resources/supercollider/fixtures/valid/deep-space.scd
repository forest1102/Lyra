(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=110|
    var env = EnvGen.kr(Env.asr(2, 1, 5), gate, doneAction: Done.freeSelf);
    var sig = SinOsc.ar(freq * [1, 1.5]) * 0.5;
    Out.ar(out, Splay.ar(sig, 0.6, amp) * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pseq([4, 6, 8], inf), \degree, Pwhite(-7, 7, inf), \amp, 0.07)
);
)
