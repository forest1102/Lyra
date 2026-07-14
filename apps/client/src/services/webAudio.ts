import type { MusicDraft, MusicTrack } from "@lyra/domain";

type PreviewTrack = Pick<MusicDraft | MusicTrack, "theme" | "bpm" | "brightness" | "density" | "motion">;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let sources: OscillatorNode[] = [];

export async function playBrowserPreview(track: PreviewTrack): Promise<void> {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    throw new Error("ブラウザの音声機能を利用できません");
  }
  stopBrowserPreview();
  context ??= new window.AudioContext();
  await context.resume();

  const now = context.currentTime;
  const root = {
    "deep-space": 55,
    "rainy-cabin": 73.42,
    "minimal-pulse": 82.41,
    "organic-drift": 65.41
  }[track.theme];
  const brightness = { low: 700, medium: 1_300, high: 2_300 }[track.brightness];
  const voiceCount = { low: 2, medium: 3, high: 4 }[track.density];
  const movement = { low: 0.004, medium: 0.008, high: 0.014 }[track.motion];

  master = context.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.045, now + 0.35);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = brightness;
  filter.Q.value = 0.7;
  filter.connect(master);
  master.connect(context.destination);

  const ratios = [1, 1.5, 2, 2.5];
  sources = ratios.slice(0, voiceCount).map((ratio, index) => {
    const oscillator = context!.createOscillator();
    oscillator.type = index % 2 === 0 ? "sine" : "triangle";
    oscillator.frequency.value = root * ratio;
    oscillator.detune.value = index * 3 - 4;
    oscillator.connect(filter);
    oscillator.start(now);
    return oscillator;
  });

  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  lfo.frequency.value = Math.max(0.04, track.bpm / 60 / 8);
  lfoDepth.gain.value = movement;
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
