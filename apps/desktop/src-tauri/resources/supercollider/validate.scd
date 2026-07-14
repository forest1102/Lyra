var path = "LYRA_TRACK_PATH".getenv;
var source;
var track;
var synthDefBytes;
var stream;
var durations = List.new;
var amplitudes = List.new;
var event;
var json;

try {
  if(path.isNil) { Error("LYRA_TRACK_PATH is required").throw };
  source = File.readAllString(path);
  source.interpret;
  track = ~lyraTrack;
  if(track.isNil) { Error("source did not assign ~lyraTrack").throw };

  synthDefBytes = track[\synthDefs].collect({ |definition|
    var size = definition.asBytes.size;
    if(size > 65536) { Error("SynthDef exceeds 64 KiB").throw };
    size;
  });
  if(synthDefBytes.sum > 262144) { Error("SynthDefs exceed 256 KiB total").throw };

  stream = track[\pattern].asStream;
  256.do({
    event = stream.next(Event.default);
    if(event.isNil) { Error("pattern ended within 256 events").throw };
    durations.add(event[\dur].value.asFloat);
    amplitudes.add((event[\amp] ? 0.1).value.asFloat);
  });
  if(durations.minItem < 0.0625 or: { durations.maxItem > 32 }) {
    Error("dur must remain between 0.0625 and 32").throw;
  };
  if(amplitudes.minItem < 0 or: { amplitudes.maxItem > 0.2 }) {
    Error("amp must remain between 0 and 0.2").throw;
  };

  json = "{\"synthDefBytes\":[%],\"eventsEvaluated\":256,\"minDuration\":%,\"maxDuration\":%,\"minAmplitude\":%,\"maxAmplitude\":%}".format(
    synthDefBytes.collect(_.asString).join(","),
    durations.minItem,
    durations.maxItem,
    amplitudes.minItem,
    amplitudes.maxItem
  );
  ("LYRA_VALIDATION:" ++ json).postln;
  0.exit;
} { |error|
  ("LYRA_VALIDATION_ERROR:" ++ error.asString).postln;
  1.exit;
};
