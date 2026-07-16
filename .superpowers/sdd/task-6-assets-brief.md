# Task 6a: Music Alchemy raster assets

Create the project-local raster assets needed by the approved design, without touching application code.

- Use the built-in image generation tool and the `imagegen` skill. Generate one final image per distinct mood asset; do not use external stock/search results.
- Produce 30 unique 4:3 mood images under `apps/desktop/public/moods/`, 6 for each category: scene, time, texture, temperature, energy. Use stable kebab-case mood IDs/filenames that match the catalog if it exists; coordinate by reading `apps/desktop/shared/moods.v1.json` when available. If it is not yet present, create a manifest proposal in the report but wait briefly/recheck before choosing IDs.
- Images should be cinematic, dark, elegant, tactile, locally coherent with the accepted Music Alchemy concept: nocturnal water, warm interiors, cosmic/forest/rain/desert ambience, no people, no typography, no logos/watermarks, usable at 160×112 crop.
- Also generate one tall sidebar still-life asset under `apps/desktop/public/brand/studio-still-life.webp`: analog turntable, amber filament lamp, dark books, plant, black walnut surface, mostly dark upper negative space, no text/logo.
- Final files must be local WebP, sensibly compressed, and visually inspected. Do not leave code references pointing outside the repo.
- Create `.superpowers/sdd/task-6-assets-report.md` listing IDs, file paths, final prompt family, generation mode, dimensions, and inspection results. Do not commit.
