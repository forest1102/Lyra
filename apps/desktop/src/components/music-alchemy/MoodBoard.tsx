import { CheckIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MOOD_CATALOG, type MoodCatalogCategory, type MusicRecipeV1 } from "../../services/moodCatalog";

interface MoodBoardProps {
  activeCategory: MoodCatalogCategory["id"];
  recipe: MusicRecipeV1;
  onCategoryChange(category: MoodCatalogCategory["id"]): void;
  onMoodToggle(moodId: string): void;
}

export function MoodBoard({ activeCategory, recipe, onCategoryChange, onMoodToggle }: MoodBoardProps) {
  const category = MOOD_CATALOG.categories.find((candidate) => candidate.id === activeCategory) ?? MOOD_CATALOG.categories[0];
  const selected = new Set(recipe.moods.map((mood) => mood.moodId));

  return (
    <section className="alchemy-mood-board" aria-labelledby="alchemy-mood-board-title">
      <div className="alchemy-section-heading">
        <span id="alchemy-mood-board-title">ムードを選ぶ</span>
        <span>{recipe.moods.length}/5</span>
      </div>
      <ToggleGroup
        type="single"
        value={activeCategory}
        variant="outline"
        size="sm"
        aria-label="ムードの分類"
        className="alchemy-categories"
        onValueChange={(value) => {
          if (value) onCategoryChange(value as MoodCatalogCategory["id"]);
        }}
      >
        {MOOD_CATALOG.categories.map((candidate) => (
          <ToggleGroupItem key={candidate.id} value={candidate.id} aria-label={candidate.label}>
            {candidate.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="alchemy-mood-grid">
        {category.moods.map((mood) => {
          const isSelected = selected.has(mood.id);
          return (
            <button
              key={mood.id}
              type="button"
              className="alchemy-mood"
              aria-label={mood.label}
              aria-pressed={isSelected}
              style={{ "--mood-color": mood.color } as React.CSSProperties}
              onClick={() => onMoodToggle(mood.id)}
            >
              <span className="alchemy-mood-image">
                <img src={mood.image} alt={mood.label} loading="lazy" />
                <span className="alchemy-mood-check" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
              </span>
              <span className="alchemy-mood-label">{mood.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
