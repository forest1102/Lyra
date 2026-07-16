import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { MoodVectorKey, MusicRecipeV1 } from "../../services/moodCatalog";
import { describeRecipe } from "../../services/moodCatalog";

interface OrbStop {
  moodId: string;
  label: string;
  color: string;
  weight: number;
}

export interface OrbModel {
  stops: OrbStop[];
  vectors: Record<MoodVectorKey, number>;
  motion: number;
}

const VECTOR_KEYS: MoodVectorKey[] = ["brightness", "density", "motion", "warmth", "space", "pulse", "melody", "organic"];

export function createOrbModel(recipe: MusicRecipeV1 | null): OrbModel {
  if (!recipe) {
    return {
      stops: [
        { moodId: "fallback-night", label: "静かな夜", color: "#52688b", weight: 0.5 },
        { moodId: "fallback-warmth", label: "穏やかな灯り", color: "#ba8b61", weight: 0.5 },
      ],
      vectors: Object.fromEntries(VECTOR_KEYS.map((key) => [key, 0])) as Record<MoodVectorKey, number>,
      motion: 0,
    };
  }

  const selections = describeRecipe(recipe);
  const vectors = Object.fromEntries(VECTOR_KEYS.map((key) => [
    key,
    selections.reduce((sum, selection) => sum + selection.mood.vectors[key] * selection.weight, 0),
  ])) as Record<MoodVectorKey, number>;
  return {
    stops: selections.map(({ mood, moodId, weight }) => ({ moodId, weight, label: mood.label, color: mood.color })),
    vectors,
    motion: vectors.motion,
  };
}

function drawOrb(context: CanvasRenderingContext2D, size: number, model: OrbModel, elapsed: number, still: boolean) {
  const center = size / 2;
  const radius = size * 0.39;
  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#090b0b";
  context.fillRect(0, 0, size, size);

  model.stops.forEach((stop, index) => {
    const phase = still ? index * 2.2 : elapsed * (0.00008 + model.motion * 0.00014) + index * 2.2;
    const x = center + Math.cos(phase) * radius * 0.34;
    const y = center + Math.sin(phase * 0.87) * radius * 0.31;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius * (0.78 + stop.weight * 0.45));
    gradient.addColorStop(0, `${stop.color}e8`);
    gradient.addColorStop(0.48, `${stop.color}70`);
    gradient.addColorStop(1, `${stop.color}00`);
    context.globalCompositeOperation = index === 0 ? "source-over" : "screen";
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });

  context.globalCompositeOperation = "screen";
  const particleCount = still ? 22 : 32 + Math.round(model.vectors.density * 24);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = index * 2.399 + (still ? 0 : elapsed * 0.00008 * (0.2 + model.motion));
    const distance = radius * (0.12 + ((index * 37) % 83) / 100);
    const x = center + Math.cos(angle) * distance;
    const y = center + Math.sin(angle) * distance;
    const alpha = 0.14 + ((index * 17) % 41) / 100;
    context.fillStyle = `rgba(238,233,220,${alpha})`;
    context.beginPath();
    context.arc(x, y, index % 7 === 0 ? 1.6 : 0.8, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

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
  onWeightChange,
}: {
  recipe: MusicRecipeV1 | null;
  onWeightChange?: (moodId: string, weight: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const model = useMemo(() => createOrbModel(recipe), [recipe]);

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
      drawOrb(context, size, model, elapsed, media.matches);
      if (!media.matches) frame = window.requestAnimationFrame(render);
    };
    render(0);
    return () => window.cancelAnimationFrame(frame);
  }, [model]);

  return (
    <figure className="mood-orb" aria-label="選択したムードの融合">
      <canvas ref={canvasRef} className="mood-orb-canvas" width="480" height="480" aria-hidden="true" />
      <div className="mood-orb-points" aria-label="ムードの重みを調整">
        {model.stops.map((stop, index) => (
          <button
            key={stop.moodId}
            type="button"
            className="mood-orb-point"
            style={{ "--point-angle": `${(360 / model.stops.length) * index - 90}deg`, "--point-color": stop.color } as CSSProperties}
            aria-label={`${stop.label} ${Math.round(stop.weight * 100)}%`}
            title={`${stop.label} ${Math.round(stop.weight * 100)}%`}
            onClick={() => onWeightChange?.(stop.moodId, Math.min(1, stop.weight + 0.1))}
          />
        ))}
      </div>
      <figcaption className="sr-only">
        {model.stops.map((stop) => `${stop.label} ${Math.round(stop.weight * 100)}%`).join("、")}
      </figcaption>
    </figure>
  );
}
