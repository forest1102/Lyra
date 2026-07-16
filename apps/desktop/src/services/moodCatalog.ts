import catalogJson from "../../shared/moods.v1.json";

export type MoodVectorKey = "brightness" | "density" | "motion" | "warmth" | "space" | "pulse" | "melody" | "organic";

export interface MoodCatalogItem {
  id: string;
  label: string;
  image: string;
  color: string;
  vectors: Record<MoodVectorKey, number>;
}

export interface MoodCatalogCategory {
  id: "scene" | "time" | "texture" | "temperature" | "energy";
  label: string;
  moods: MoodCatalogItem[];
}

export interface MoodCatalogV1 {
  version: 1;
  categories: MoodCatalogCategory[];
}

export interface MoodSelection {
  moodId: string;
  weight: number;
}

export interface MusicRecipeV1 {
  version: 1;
  moods: MoodSelection[];
}

export const MOOD_CATALOG = catalogJson as MoodCatalogV1;
export const MOODS = MOOD_CATALOG.categories.flatMap((category) => category.moods);
export const MOOD_BY_ID = new Map(MOODS.map((mood) => [mood.id, mood]));

export function createMusicRecipe(moodIds: string[]): MusicRecipeV1 {
  const weight = moodIds.length > 0 ? 1 / moodIds.length : 0;
  return normalizeMusicRecipe({
    version: 1,
    moods: moodIds.map((moodId) => ({ moodId, weight })),
  });
}

export function normalizeMusicRecipe(recipe: MusicRecipeV1): MusicRecipeV1 {
  if (recipe.version !== 1) throw new Error("unsupported music recipe version");
  if (recipe.moods.length < 1 || recipe.moods.length > 5) throw new Error("music recipe requires 1 to 5 moods");

  const seen = new Set<string>();
  let total = 0;
  for (const selection of recipe.moods) {
    if (!MOOD_BY_ID.has(selection.moodId)) throw new Error(`unknown mood: ${selection.moodId}`);
    if (seen.has(selection.moodId)) throw new Error(`duplicate mood: ${selection.moodId}`);
    if (!Number.isFinite(selection.weight) || selection.weight <= 0) throw new Error("mood weight must be a positive finite number");
    seen.add(selection.moodId);
    total += selection.weight;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error("mood weights must have a positive total");

  let accumulated = 0;
  const moods = recipe.moods.map((selection, index) => {
    const weight = Number((index === recipe.moods.length - 1 ? 1 - accumulated : selection.weight / total).toFixed(12));
    accumulated += weight;
    return { moodId: selection.moodId, weight };
  });
  return { version: 1, moods };
}

export function describeRecipe(recipe: MusicRecipeV1): Array<MoodSelection & { mood: MoodCatalogItem }> {
  return normalizeMusicRecipe(recipe).moods.map((selection) => ({
    ...selection,
    mood: MOOD_BY_ID.get(selection.moodId)!,
  }));
}
