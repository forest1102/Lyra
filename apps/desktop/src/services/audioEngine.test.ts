import { describe, expect, test, vi } from "vitest";
import {
  AudioEngine,
  AudioValidationContextPool,
  connectSystemOutput,
  injectChuckSeed,
  isDraftValidationReportSafe,
  scheduleMasterVolume,
  type AudioDeck,
  type AudioHost,
} from "./audioEngine";

class FakeDeck implements AudioDeck {
  readonly starts: string[] = [];
  readonly fades: Array<[number, number]> = [];
  destroyed = false;

  async start(source: string) { this.starts.push(source); }
  fadeTo(value: number, seconds: number) { this.fades.push([value, seconds]); }
  async destroy() { this.destroyed = true; }
}

class FakeHost implements AudioHost {
  readonly decks: FakeDeck[] = [];
  readonly errors: Array<() => void> = [];
  suspend = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  setVolume = vi.fn();
  prepareForUserGesture = vi.fn();
  validateSource = vi.fn(async () => ({ durationMs: 5000 as const, elapsedAudioSeconds: 5, peak: 0.5, nonSilentMs: 500, nonFiniteSamples: 0, processorErrors: 0 }));

  async createDeck(onProcessorError: () => void) {
    const deck = new FakeDeck();
    this.decks.push(deck);
    this.errors.push(onProcessorError);
    return deck;
  }

}

const SOURCE = "Math.srandom(__LYRA_SEED__); SinOsc osc => dac; while(true) { 500::ms => now; }";

describe("AudioEngine", () => {
  test("injects only the required ChucK seed call", () => {
    expect(injectChuckSeed(`// __LYRA_SEED__\n${SOURCE}`, 42)).toContain("Math.srandom(42);");
    expect(() => injectChuckSeed("SinOsc osc => dac;", 42)).toThrow("seed placeholder");
  });

  test("loads a standby deck before a two second crossfade", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    await engine.play({ trackId: "first", source: SOURCE, seed: 1 });
    await engine.play({ trackId: "second", source: SOURCE, seed: 2 });

    expect(host.decks[0].fades).toContainEqual([0, 2]);
    expect(host.decks[1].fades).toContainEqual([1, 2]);
    expect(host.decks[1].starts[0]).toContain("Math.srandom(2);");
    expect(engine.getState()).toEqual({ status: "playing", trackId: "second", disabled: false });
  });

  test("applies volume to the host output without rebuilding decks", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    await engine.play({ trackId: "track", source: SOURCE, seed: 7 });

    engine.setVolume(0.42);

    expect(host.setVolume).toHaveBeenCalledWith(0.42);
    expect(host.decks).toHaveLength(1);
  });

  test("uses the configured crossfade for subsequent track changes", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    engine.setCrossfadeSeconds(6.5);

    await engine.play({ trackId: "first", source: SOURCE, seed: 1 });
    await engine.play({ trackId: "second", source: SOURCE, seed: 2 });

    expect(host.decks[0].fades).toContainEqual([0, 6.5]);
    expect(host.decks[1].fades).toContainEqual([1, 6.5]);
  });

  test("clamps unsafe audio setting values", () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);

    engine.setVolume(4);
    engine.setCrossfadeSeconds(-3);

    expect(host.setVolume).toHaveBeenCalledWith(2);
    expect(engine.getCrossfadeSeconds()).toBe(0);
  });

  test("pauses, resumes, and stops client playback", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    await engine.play({ trackId: "track", source: SOURCE, seed: 7 });
    host.resume.mockClear();
    await engine.pause();
    expect(host.suspend).toHaveBeenCalledOnce();
    expect(engine.getState().status).toBe("paused");
    await engine.resume();
    expect(host.resume).toHaveBeenCalledOnce();
    await engine.stop();
    expect(host.decks[0].destroyed).toBe(true);
    expect(engine.getState().status).toBe("stopped");
  });

  test("primes the output synchronously from a user gesture", () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);

    engine.prepareForUserGesture();

    expect(host.prepareForUserGesture).toHaveBeenCalledOnce();
  });

  test("retries one processor failure then disables BGM", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    await engine.play({ trackId: "track", source: SOURCE, seed: 7 });
    host.errors[0]();
    await vi.waitFor(() => expect(host.decks).toHaveLength(2));
    host.errors[1]();
    await vi.waitFor(() => expect(engine.getState().disabled).toBe(true));
    expect(engine.getState().status).toBe("stopped");
  });

  test("keeps only the latest overlapping play request", async () => {
    const host = new FakeHost();
    const releases: Array<() => void> = [];
    host.createDeck = vi.fn(async (onProcessorError: () => void) => {
      const deck = new FakeDeck();
      host.decks.push(deck);
      host.errors.push(onProcessorError);
      await new Promise<void>((resolve) => releases.push(resolve));
      return deck;
    });
    const engine = new AudioEngine(host);
    const first = engine.play({ trackId: "first", source: SOURCE, seed: 1 });
    const second = engine.play({ trackId: "second", source: SOURCE, seed: 2 });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await second;
    releases[0]();
    await first;

    expect(engine.getState().trackId).toBe("second");
    expect(host.decks[0].destroyed).toBe(true);
  });

  test("ignores processor errors from a faded-out deck", async () => {
    const host = new FakeHost();
    const engine = new AudioEngine(host);
    await engine.play({ trackId: "first", source: SOURCE, seed: 1 });
    await engine.play({ trackId: "second", source: SOURCE, seed: 2 });
    host.errors[0]();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(host.decks).toHaveLength(2);
    expect(engine.getState().trackId).toBe("second");
  });
});

test("connects playback to the system default and mutes only E2E output", () => {
  const destination = {} as AudioDestinationNode;
  const master = {
    gain: { value: 1.5 },
    connect: vi.fn(),
  } as unknown as GainNode;
  const output = {
    gain: { value: 1 },
    connect: vi.fn(),
  } as unknown as GainNode;
  const limiter = { connect: vi.fn() } as unknown as DynamicsCompressorNode;
  const context = {
    destination,
    createGain: vi.fn()
      .mockReturnValueOnce(master)
      .mockReturnValueOnce(output),
  } as unknown as AudioContext;

  expect(connectSystemOutput(context, limiter, true)).toEqual({ master, output });
  expect(master.connect).toHaveBeenCalledWith(limiter);
  expect(limiter.connect).toHaveBeenCalledWith(output);
  expect(output.connect).toHaveBeenCalledWith(destination);
  expect(output.gain.value).toBe(0);

  const unmutedMaster = {
    gain: { value: 1.5 },
    connect: vi.fn(),
  } as unknown as GainNode;
  const unmutedOutput = {
    gain: { value: 0 },
    connect: vi.fn(),
  } as unknown as GainNode;
  vi.mocked(context.createGain)
    .mockReturnValueOnce(unmutedMaster)
    .mockReturnValueOnce(unmutedOutput);
  connectSystemOutput(context, limiter, false);
  expect(unmutedOutput.gain.value).toBe(1);
});

test("ramps the shared master gain over twenty milliseconds after cancelling automation", () => {
  const gain = {
    value: 1.5,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  } as unknown as AudioParam;
  const master = { gain } as GainNode;

  scheduleMasterVolume(master, 12, 4);

  expect(gain.cancelScheduledValues).toHaveBeenCalledWith(12);
  expect(gain.setValueAtTime).toHaveBeenCalledWith(1.5, 12);
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(2, 12.02);
});

test("prepares and reuses a validation AudioContext before asynchronous work", async () => {
  const context = {
    state: "suspended",
    resume: vi.fn(async () => undefined),
  } as unknown as AudioContext;
  const factory = vi.fn(() => context);
  const pool = new AudioValidationContextPool(factory);

  pool.prepareForUserGesture();
  expect(context.resume).toHaveBeenCalledOnce();

  const prepared = pool.take();
  await prepared.resumed;
  expect(prepared.context).toBe(context);
  expect(factory).toHaveBeenCalledOnce();
});

test("accepts only the five second audio safety report", () => {
  expect(isDraftValidationReportSafe({ durationMs: 5000, elapsedAudioSeconds: 5, peak: 0.8, nonSilentMs: 300, nonFiniteSamples: 0, processorErrors: 0 })).toBe(true);
  expect(isDraftValidationReportSafe({ durationMs: 5000, elapsedAudioSeconds: 5, peak: 1.1, nonSilentMs: 300, nonFiniteSamples: 0, processorErrors: 0 })).toBe(false);
});
