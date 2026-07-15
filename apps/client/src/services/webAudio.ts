import type { MusicDraft, MusicTrack } from "@lyra/domain";

type PreviewTrack = Pick<
  MusicDraft | MusicTrack,
  "theme" | "arrangement" | "bpm" | "brightness" | "density" | "motion"
>;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let sources: OscillatorNode[] = [];

export function browserPreviewPlan(track: PreviewTrack) {
  const root = {
    "deep-space": 220,
    "rainy-cabin": 246.94,
    "minimal-pulse": 261.63,
    "organic-drift": 233.08
  }[track.theme];
  const arrangement = {
    ambient: {
      ratios: [1, 1.5, 2, 2.5],
      oscillatorTypes: ["sine", "triangle", "sine", "triangle"] as OscillatorType[],
      lfoDivisor: 16
    },
    lofi: {
      ratios: [1, 1.25, 1.5, 2],
      oscillatorTypes: ["triangle", "sine", "triangle", "sine"] as OscillatorType[],
      lfoDivisor: 8
    },
    "minimal-melody": {
      ratios: [1.25, 1.5, 2, 2.5],
      oscillatorTypes: ["sine", "sine", "triangle", "sine"] as OscillatorType[],
      lfoDivisor: 4
    }
  }[track.arrangement];
  const voiceCount = { low: 2, medium: 3, high: 4 }[track.density];

  return {
    frequencies: arrangement.ratios.slice(0, voiceCount).map((ratio) => root * ratio),
    oscillatorTypes: arrangement.oscillatorTypes.slice(0, voiceCount),
    filterFrequency: { low: 1_400, medium: 2_600, high: 4_800 }[track.brightness],
    movementDepth: { low: 0.002, medium: 0.004, high: 0.007 }[track.motion],
    lfoFrequency: Math.max(0.03, track.bpm / 60 / arrangement.lfoDivisor),
    masterGain: { low: 0.038, medium: 0.032, high: 0.027 }[track.density]
  };
}

export async function playBrowserPreview(track: PreviewTrack): Promise<void> {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    throw new Error("ブラウザの音声機能を利用できません");
  }
  stopBrowserPreview();
  context ??= new window.AudioContext();
  await context.resume();

  const now = context.currentTime;
  const plan = browserPreviewPlan(track);

  master = context.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(plan.masterGain, now + 0.35);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = plan.filterFrequency;
  filter.Q.value = 0.7;
  filter.connect(master);
  master.connect(context.destination);

  sources = plan.frequencies.map((frequency, index) => {
    const oscillator = context!.createOscillator();
    oscillator.type = plan.oscillatorTypes[index];
    oscillator.frequency.value = frequency;
    oscillator.detune.value = index * 1.5 - 2;
    oscillator.connect(filter);
    oscillator.start(now);
    return oscillator;
  });

  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  lfo.frequency.value = plan.lfoFrequency;
  lfoDepth.gain.value = plan.movementDepth;
  lfo.connect(lfoDepth);
  lfoDepth.connect(master.gain);
  lfo.start(now);
  sources.push(lfo);
}

export function stopBrowserPreview(): void {
  if (!context || !master) return;
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.2);
  for (const source of sources) {
    try { source.stop(now + 0.22); } catch { /* The source has already stopped. */ }
  }
  sources = [];
  master = null;
}
