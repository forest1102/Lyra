import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { MoodVectorKey, MusicRecipeV1 } from "../../services/moodCatalog";
import { describeRecipe } from "../../services/moodCatalog";
import { isActiveGenerationPhase, type MusicGenerationPhase } from "../../services/musicGeneration";

interface OrbStop {
  moodId: string;
  label: string;
  color: string;
  weight: number;
  particleCount: number;
  orbitRadius: number;
}

export interface OrbModel {
  stops: OrbStop[];
  vectors: Record<MoodVectorKey, number>;
  motion: number;
  phase: MusicGenerationPhase;
  speed: number;
  convergence: number;
  reconstructive: boolean;
  cycleMs: number;
  settleDurationMs: number;
}

const VECTOR_KEYS: MoodVectorKey[] = ["brightness", "density", "motion", "warmth", "space", "pulse", "melody", "organic"];
const CYCLE_MS = 2_400;
const SETTLE_DURATION_MS = 600;

const PHASE_DYNAMICS: Record<MusicGenerationPhase, Pick<OrbModel, "speed" | "convergence" | "reconstructive">> = {
  idle: { speed: 1, convergence: 0, reconstructive: false },
  composing: { speed: 1.7, convergence: 0.38, reconstructive: false },
  source_validating: { speed: 2.3, convergence: 0.82, reconstructive: false },
  repairing: { speed: 3.4, convergence: 0.68, reconstructive: true },
  ready: { speed: 1, convergence: 0, reconstructive: false },
  audio: { speed: 1, convergence: 0, reconstructive: false },
  deferred: { speed: 1, convergence: 0, reconstructive: false },
  completed: { speed: 1, convergence: 0, reconstructive: false },
  failed: { speed: 1, convergence: 0, reconstructive: false },
};

export function createOrbModel(recipe: MusicRecipeV1 | null, phase: MusicGenerationPhase = "idle"): OrbModel {
  const fallbackStops = [
    { moodId: "fallback-night", label: "静かな夜", color: "#52688b", weight: 0.5 },
    { moodId: "fallback-warmth", label: "穏やかな灯り", color: "#ba8b61", weight: 0.5 },
  ];
  const described = recipe ? describeRecipe(recipe) : null;
  const selections = described
    ? described.map(({ mood, moodId, weight }) => ({ moodId, weight, label: mood.label, color: mood.color }))
    : fallbackStops;
  const vectors = described
    ? Object.fromEntries(VECTOR_KEYS.map((key) => [
        key,
        described.reduce((sum, selection) => sum + selection.mood.vectors[key] * selection.weight, 0),
      ])) as Record<MoodVectorKey, number>
    : Object.fromEntries(VECTOR_KEYS.map((key) => [key, 0])) as Record<MoodVectorKey, number>;
  const particleTotal = 36 + Math.round(vectors.density * 28);
  const dynamics = PHASE_DYNAMICS[phase];

  return {
    stops: selections.map((stop) => ({
      ...stop,
      particleCount: Math.max(4, Math.round(particleTotal * stop.weight)),
      orbitRadius: 0.2 + (1 - stop.weight) * 0.3,
    })),
    vectors,
    motion: vectors.motion,
    phase,
    ...dynamics,
    cycleMs: CYCLE_MS,
    settleDurationMs: phase === "ready" ? SETTLE_DURATION_MS : 0,
  };
}

export function createOrbTransition(phase: MusicGenerationPhase, previousPhase: MusicGenerationPhase) {
  const settling = phase === "ready" && isActiveGenerationPhase(previousPhase);
  return { settling, displayPhase: settling ? previousPhase : phase };
}

function drawOrb(
  context: CanvasRenderingContext2D,
  size: number,
  model: OrbModel,
  elapsed: number,
  staticMode: boolean,
  activity = 1,
) {
  const center = size / 2;
  const radius = size * 0.39;
  const activeIntensity = isActiveGenerationPhase(model.phase) ? activity : 0;
  const cycle = staticMode ? 0 : (elapsed % model.cycleMs) / model.cycleMs;
  const dissolve = Math.pow(Math.sin(cycle * Math.PI), 4) * activeIntensity;
  const speed = 1 + (model.speed - 1) * activity;
  const convergence = model.convergence * activity;

  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#090b0b";
  context.fillRect(0, 0, size, size);

  model.stops.forEach((stop, index) => {
    const phase = staticMode ? index * 2.2 : elapsed * 0.00008 * speed * (0.45 + model.motion) + index * 2.2;
    const colorRadius = radius * (0.74 + stop.weight * 0.5);
    const x = center + Math.cos(phase) * radius * stop.orbitRadius;
    const y = center + Math.sin(phase * 0.87) * radius * stop.orbitRadius;
    const gradient = context.createRadialGradient(x, y, 0, x, y, colorRadius);
    gradient.addColorStop(0, `${stop.color}e8`);
    gradient.addColorStop(0.48, `${stop.color}70`);
    gradient.addColorStop(1, `${stop.color}00`);
    context.globalCompositeOperation = index === 0 ? "source-over" : "screen";
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });

  if (staticMode) {
    model.stops.forEach((stop, index) => {
      const bandRadius = radius * (0.2 + ((index + 1) / (model.stops.length + 1)) * 0.62);
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.34 + stop.weight * 0.4;
      context.strokeStyle = stop.color;
      context.lineWidth = 5 + stop.weight * 12;
      context.beginPath();
      context.arc(center, center, bandRadius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.9;
      context.fillStyle = "#eee9dc";
      context.font = "12px sans-serif";
      context.textAlign = "center";
      context.fillText(stop.label, center, center - bandRadius + 4);
    });
  }

  context.globalCompositeOperation = "screen";
  model.stops.forEach((stop, stopIndex) => {
    const stopPhase = stopIndex * 2.2 + elapsed * 0.00008 * speed;
    for (let index = 0; index < stop.particleCount; index += 1) {
      const seed = index / stop.particleCount;
      const angle = stopPhase + index * 2.399 + (model.reconstructive ? Math.sin(elapsed * 0.006 + index) * 0.25 * activity : 0);
      const baseDistance = radius * (stop.orbitRadius + seed * 0.44);
      const inward = dissolve * (0.62 + convergence * 0.38);
      const distance = staticMode ? baseDistance : baseDistance * (1 - inward);
      const x = center + Math.cos(angle) * distance;
      const y = center + Math.sin(angle) * distance;
      context.globalAlpha = 0.2 + ((index * 17) % 47) / 100 + dissolve * 0.22;
      context.fillStyle = stop.color;
      context.beginPath();
      context.arc(x, y, index % 7 === 0 ? 1.8 : 0.9, 0, Math.PI * 2);
      context.fill();
    }

    if (!staticMode) {
      const labelDistance = radius * stop.orbitRadius * (1 - dissolve * (0.7 + convergence * 0.2));
      context.globalAlpha = Math.max(0.08, 1 - dissolve * 1.12);
      context.fillStyle = "#eee9dc";
      context.font = "12px sans-serif";
      context.textAlign = "center";
      context.fillText(stop.label, center + Math.cos(stopPhase) * labelDistance, center + Math.sin(stopPhase) * labelDistance);
    }
  });
  context.restore();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";

  context.strokeStyle = "rgba(238,233,220,.22)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "rgba(216,240,104,.16)";
  context.beginPath();
  context.arc(center, center, radius * 1.13, 0, Math.PI * 2);
  context.stroke();
}

export function MoodOrb({
  recipe,
  phase = "idle",
  editingDisabled = false,
  onWeightChange,
}: {
  recipe: MusicRecipeV1 | null;
  phase?: MusicGenerationPhase;
  editingDisabled?: boolean;
  onWeightChange?: (moodId: string, weight: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transitionSession = useRef({
    phase,
    displayPhase: phase,
    settling: false,
    startedAt: null as number | null,
    runId: 0,
  });
  if (transitionSession.current.phase !== phase) {
    const transition = createOrbTransition(phase, transitionSession.current.phase);
    transitionSession.current = {
      phase,
      ...transition,
      startedAt: null,
      runId: transitionSession.current.runId + 1,
    };
  }
  const recipeSignature = recipe?.moods.map(({ moodId, weight }) => `${moodId}:${weight}`).join("|") ?? "fallback";
  const { settling, displayPhase, runId } = transitionSession.current;
  const model = useMemo(() => createOrbModel(recipe, displayPhase), [displayPhase, recipeSignature]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const size = 480;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * scale;
    canvas.height = size * scale;
    context.scale(scale, scale);
    let frame = 0;

    const render = (elapsed: number) => {
      if (transitionSession.current.runId !== runId) return;
      if (settling && transitionSession.current.startedAt === null) transitionSession.current.startedAt = elapsed;
      const settleElapsed = settling ? elapsed - (transitionSession.current.startedAt ?? elapsed) : 0;
      const activity = settling ? Math.max(0, 1 - settleElapsed / SETTLE_DURATION_MS) : 1;
      drawOrb(context, size, model, elapsed, false, activity);
      frame = window.requestAnimationFrame(render);
    };
    const renderForPreference = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (media.matches) {
        drawOrb(context, size, model, 0, true);
      } else {
        drawOrb(context, size, model, 0, false, 1);
        frame = window.requestAnimationFrame(render);
      }
    };
    renderForPreference();
    media.addEventListener("change", renderForPreference);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", renderForPreference);
    };
  }, [model, runId, settling]);

  const weightFixed = model.stops.length === 1;

  return (
    <figure className="mood-orb" aria-label="選択したムードの融合">
      <canvas ref={canvasRef} className="mood-orb-canvas" width="480" height="480" aria-hidden="true" />
      <div className="mood-orb-points" aria-label="ムードの重みを調整">
        {model.stops.map((stop, index) => {
          const weightLabel = `${stop.label} ${Math.round(stop.weight * 100)}%${weightFixed ? "。ムードが1つのため重みは100%に固定されています" : ""}`;
          return (
            <button
              key={stop.moodId}
              type="button"
              className="mood-orb-point"
              style={{ "--point-angle": `${(360 / model.stops.length) * index - 90}deg`, "--point-color": stop.color } as CSSProperties}
              aria-label={weightLabel}
              title={weightLabel}
              disabled={editingDisabled || weightFixed}
              onClick={() => onWeightChange?.(stop.moodId, Math.min(1, stop.weight + 0.1))}
            />
          );
        })}
      </div>
      <figcaption className="sr-only">
        {model.stops.map((stop) => `${stop.label} ${Math.round(stop.weight * 100)}%`).join("、")}
      </figcaption>
    </figure>
  );
}
