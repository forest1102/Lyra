(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0|
    var env = EnvGen.kr(Env.asr, gate, doneAction: Done.freeSelf)
    Out.ar(out, Pan2.ar(SinOsc.ar(220), pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pseq([1], inf), \amp, 0.08)
);
