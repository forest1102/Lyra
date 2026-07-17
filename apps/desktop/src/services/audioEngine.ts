import type { DraftValidationReport, MusicPlaybackState } from "../domain";

declare const __WEBCHUCK_ASSET_ROOT__: string;

const WEBCHUCK_ASSET_ROOT = typeof __WEBCHUCK_ASSET_ROOT__ === "string"
  ? __WEBCHUCK_ASSET_ROOT__
  : "/webchuck/";
const SEED_CALL = "Math.srandom(__LYRA_SEED__);";
const DEFAULT_CROSSFADE_SECONDS = 2;

export interface AudioDeck {
  start(source: string): Promise<void>;
  fadeTo(value: number, seconds: number): void;
  destroy(): Promise<void>;
}

export interface AudioHost {
  createDeck(onProcessorError: () => void): Promise<AudioDeck>;
  validateSource(source: string, seed: number): Promise<DraftValidationReport>;
  prepareForUserGesture(): void;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  setVolume(value: number): void;
}

interface PlayRequest {
  trackId: string;
  source: string;
  seed: number;
}

type StateListener = (state: MusicPlaybackState) => void;

export function injectChuckSeed(source: string, seed: number): string {
  const index = source.indexOf(SEED_CALL);
  if (index < 0 || source.indexOf(SEED_CALL, index + SEED_CALL.length) >= 0) {
    throw new Error("ChucK seed placeholder is missing or duplicated");
  }
  return `${source.slice(0, index)}Math.srandom(${Math.trunc(seed)});${source.slice(index + SEED_CALL.length)}`;
}

export function isDraftValidationReportSafe(report: DraftValidationReport): boolean {
  return report.durationMs === 5000
    && Number.isFinite(report.elapsedAudioSeconds)
    && report.elapsedAudioSeconds >= 4.9
    && Number.isFinite(report.peak)
    && report.peak >= 0
    && report.peak <= 1
    && report.nonSilentMs >= 250
    && report.nonFiniteSamples === 0
    && report.processorErrors === 0;
}

export class AudioEngine {
  private active: AudioDeck | null = null;
  private currentRequest: PlayRequest | null = null;
  private state: MusicPlaybackState = { status: "stopped", trackId: null, disabled: false };
  private listeners = new Set<StateListener>();
  private processorFailures = 0;
  private processorRecovery: Promise<void> = Promise.resolve();
  private operationId = 0;
  private pending = new Set<AudioDeck>();
  private crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS;

  constructor(private readonly host: AudioHost = new WebChuckAudioHost()) {}

  getState(): MusicPlaybackState { return this.state; }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  prepareForUserGesture(): void {
    this.host.prepareForUserGesture();
  }

  validateSource(source: string, seed: number): Promise<DraftValidationReport> {
    return this.host.validateSource(source, seed);
  }

  setVolume(value: number): void {
    const normalized = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1.5;
    this.host.setVolume(normalized);
  }

  setCrossfadeSeconds(value: number): void {
    this.crossfadeSeconds = Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : DEFAULT_CROSSFADE_SECONDS;
  }

  getCrossfadeSeconds(): number {
    return this.crossfadeSeconds;
  }

  async play(request: PlayRequest): Promise<void> {
    if (this.state.disabled) throw new Error("BGM is disabled for this focus session");
    this.processorFailures = 0;
    const operationId = ++this.operationId;
    await this.replaceDeck(request, operationId);
  }

  async pause(): Promise<void> {
    if (!this.active) return;
    await this.host.suspend();
    this.publish({ ...this.state, status: "paused" });
  }

  async resume(): Promise<void> {
    if (!this.active) return;
    await this.host.resume();
    this.publish({ ...this.state, status: "playing" });
  }

  async stop(): Promise<void> {
    this.operationId += 1;
    const active = this.active;
    this.active = null;
    this.currentRequest = null;
    const pending = [...this.pending];
    this.pending.clear();
    await Promise.all([active?.destroy(), ...pending.map((deck) => deck.destroy())]);
    this.publish({ status: "stopped", trackId: null, disabled: this.state.disabled });
  }

  resetFocusSession(): void {
    this.processorFailures = 0;
    this.publish({ ...this.state, disabled: false });
  }

  private async replaceDeck(request: PlayRequest, operationId: number): Promise<void> {
    let created: AudioDeck | null = null;
    const deck = await this.host.createDeck(() => {
      if (!created || (this.active !== created && !this.pending.has(created))) return;
      this.processorRecovery = this.processorRecovery.then(() => this.handleProcessorError());
    });
    created = deck;
    this.pending.add(deck);
    if (operationId !== this.operationId) {
      this.pending.delete(deck);
      await deck.destroy();
      return;
    }
    try {
      await deck.start(injectChuckSeed(request.source, request.seed));
    } catch (error) {
      this.pending.delete(deck);
      await deck.destroy();
      throw error;
    }
    if (operationId !== this.operationId) {
      this.pending.delete(deck);
      await deck.destroy();
      return;
    }
    this.pending.delete(deck);
    const previous = this.active;
    this.active = deck;
    this.currentRequest = request;
    const crossfadeSeconds = this.crossfadeSeconds;
    deck.fadeTo(1, crossfadeSeconds);
    if (previous) {
      previous.fadeTo(0, crossfadeSeconds);
      globalThis.setTimeout(() => { void previous.destroy(); }, crossfadeSeconds * 1000);
    }
    await this.host.resume();
    this.publish({ status: "playing", trackId: request.trackId, disabled: false });
  }

  private async handleProcessorError(): Promise<void> {
    const request = this.currentRequest;
    if (!request) return;
    this.processorFailures += 1;
    if (this.processorFailures === 1) {
      await this.replaceDeck(request, this.operationId).catch(() => this.disableForSession());
      return;
    }
    await this.disableForSession();
  }

  private async disableForSession(): Promise<void> {
    await this.stop();
    this.publish({ status: "stopped", trackId: null, disabled: true });
  }

  private publish(state: MusicPlaybackState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}

class WebChuckDeck implements AudioDeck {
  private shredId: number | null = null;

  constructor(
    private readonly chuck: import("webchuck").Chuck,
    private readonly gain: GainNode,
    private readonly context: AudioContext,
  ) {}

  async start(source: string): Promise<void> { this.shredId = await this.chuck.runCode(source); }

  fadeTo(value: number, seconds: number): void {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  async destroy(): Promise<void> {
    if (this.shredId !== null) await this.chuck.removeShred(this.shredId).catch(() => undefined);
    this.chuck.disconnect();
    this.gain.disconnect();
  }
}

export class WebChuckAudioHost implements AudioHost {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private output: GainNode | null = null;
  private volume = 1.5;

  async createDeck(onProcessorError: () => void): Promise<AudioDeck> {
    this.ensureGraph();
    const { Chuck } = await import("webchuck");
    let chuck: import("webchuck").Chuck;
    try {
      chuck = await Chuck.init([], this.context!, 2, WEBCHUCK_ASSET_ROOT);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      const destination = this.context!.destination;
      throw new Error(`WebChucK VM init failed: ${detail} (destination ${destination.channelCount}/${destination.maxChannelCount}ch)`);
    }
    chuck.onprocessorerror = onProcessorError;
    const gain = this.context!.createGain();
    gain.gain.value = 0;
    try {
      chuck.connect(gain);
      gain.connect(this.master!);
    } catch (reason) {
      chuck.disconnect();
      const detail = reason instanceof Error ? reason.message : String(reason);
      throw new Error(`WebChucK output graph failed: ${detail}`);
    }
    return new WebChuckDeck(chuck, gain, this.context!);
  }

  validateSource(source: string, seed: number): Promise<DraftValidationReport> {
    this.ensureGraph();
    const context = this.context!;
    return validateChuckSourceInContext(source, seed, { context, resumed: context.resume() }, false);
  }

  async suspend(): Promise<void> { if (this.context?.state === "running") await this.context.suspend(); }

  async resume(): Promise<void> {
    this.ensureGraph();
    if (this.context!.state === "suspended") await this.context!.resume();
  }

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1.5;
    if (this.master && this.context) {
      scheduleMasterVolume(this.master, this.context.currentTime, this.volume);
    }
  }

  prepareForUserGesture(): void {
    this.ensureGraph();
    void this.context!.resume().catch(() => undefined);
  }

  private ensureGraph(): void {
    if (this.context) return;
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    ({ master: this.master, output: this.output } = connectSystemOutput(
      this.context,
      this.limiter,
      import.meta.env.VITE_E2E === "1",
    ));
    this.setVolume(this.volume);
  }
}

export function scheduleMasterVolume(master: GainNode, now: number, value: number): void {
  const normalized = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1.5;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(normalized, now + 0.02);
}

export function connectSystemOutput(
  context: AudioContext,
  limiter: DynamicsCompressorNode,
  muted: boolean,
): { master: GainNode; output: GainNode } {
  const master = context.createGain();
  const output = context.createGain();
  output.gain.value = muted ? 0 : 1;
  master.connect(limiter);
  limiter.connect(output);
  output.connect(context.destination);
  return { master, output };
}

export interface AudioValidationContextLease {
  context: AudioContext;
  resumed: Promise<void>;
}

export class AudioValidationContextPool {
  private prepared: AudioValidationContextLease | null = null;

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  prepareForUserGesture(): void {
    if (this.prepared && this.prepared.context.state !== "closed") return;
    const context = this.createContext();
    const lease = { context, resumed: context.resume() };
    this.prepared = lease;
    void lease.resumed.catch(() => {
      if (this.prepared === lease) this.prepared = null;
      void context.close().catch(() => undefined);
    });
  }

  take(): AudioValidationContextLease {
    const prepared = this.prepared;
    if (prepared && prepared.context.state !== "closed") {
      this.prepared = null;
      return prepared;
    }
    const context = this.createContext();
    return { context, resumed: context.resume() };
  }
}

const validationContextPool = new AudioValidationContextPool();

export function prepareChuckValidationForUserGesture(): void {
  validationContextPool.prepareForUserGesture();
}

export async function validateChuckSource(source: string, seed: number): Promise<DraftValidationReport> {
  const validationContext = validationContextPool.take();
  return validateChuckSourceInContext(source, seed, validationContext, true);
}

async function validateChuckSourceInContext(
  source: string,
  seed: number,
  validationContext: AudioValidationContextLease,
  closeContext: boolean,
): Promise<DraftValidationReport> {
  const context = validationContext.context;
  let chuck: import("webchuck").Chuck | null = null;
  let shredId: number | null = null;
  let meter: AudioWorkletNode | null = null;
  let mute: GainNode | null = null;
  try {
    await validationContext.resumed;
    await context.audioWorklet.addModule("/worklets/lyra-validation-meter.js");
    const activeMeter = new AudioWorkletNode(context, "lyra-validation-meter");
    meter = activeMeter;
    mute = context.createGain();
    mute.gain.value = 0;
    activeMeter.connect(mute);
    mute.connect(context.destination);
    const { Chuck } = await import("webchuck");
    chuck = await Chuck.init([], context, 2, WEBCHUCK_ASSET_ROOT);
    chuck.connect(activeMeter);
    chuck.onprocessorerror = () => activeMeter.port.postMessage({ processorError: true });
    await context.resume();
    shredId = await chuck.runCode(injectChuckSeed(source, seed));
    const report = new Promise<DraftValidationReport>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("WebChucK validation timed out")), 6_500);
      activeMeter.port.onmessage = (event: MessageEvent<DraftValidationReport>) => {
        window.clearTimeout(timeout);
        resolve(event.data);
      };
    });
    activeMeter.port.postMessage({ start: true });
    const result = await report;
    if (!isDraftValidationReportSafe(result)) throw new Error("WebChucK audio validation failed");
    return result;
  } finally {
    if (chuck && shredId !== null) await chuck.removeShred(shredId).catch(() => undefined);
    chuck?.disconnect();
    meter?.disconnect();
    mute?.disconnect();
    if (closeContext) await context.close();
  }
}
