class LyraValidationMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0;
    this.peak = 0;
    this.nonSilentFrames = 0;
    this.nonFiniteSamples = 0;
    this.processorErrors = 0;
    this.sent = false;
    this.started = false;
    this.port.onmessage = (event) => {
      if (event.data?.start) {
        this.frames = 0;
        this.peak = 0;
        this.nonSilentFrames = 0;
        this.nonFiniteSamples = 0;
        this.processorErrors = 0;
        this.sent = false;
        this.started = true;
      } else if (event.data?.processorError) {
        this.processorErrors += 1;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.started) return true;
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frameCount = input[0]?.length ?? 128;
    let squareSum = 0;
    let sampleCount = 0;
    for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
      const channel = input[channelIndex];
      const destination = output[channelIndex];
      for (let index = 0; index < channel.length; index += 1) {
        const sample = channel[index];
        if (!Number.isFinite(sample)) this.nonFiniteSamples += 1;
        else {
          const absolute = Math.abs(sample);
          this.peak = Math.max(this.peak, absolute);
          squareSum += sample * sample;
        }
        sampleCount += 1;
        if (destination) destination[index] = Number.isFinite(sample) ? sample : 0;
      }
    }
    if (sampleCount > 0 && Math.sqrt(squareSum / sampleCount) >= Math.pow(10, -70 / 20)) {
      this.nonSilentFrames += frameCount;
    }
    this.frames += frameCount;
    if (!this.sent && this.frames >= sampleRate * 5) {
      this.sent = true;
      this.port.postMessage({
        durationMs: 5000,
        elapsedAudioSeconds: this.frames / sampleRate,
        peak: this.peak,
        nonSilentMs: Math.round(this.nonSilentFrames / sampleRate * 1000),
        nonFiniteSamples: this.nonFiniteSamples,
        processorErrors: this.processorErrors,
      });
    }
    return !this.sent;
  }
}

registerProcessor("lyra-validation-meter", LyraValidationMeter);
