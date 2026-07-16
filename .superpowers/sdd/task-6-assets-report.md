# Task 6a report: Music Alchemy raster assets

## Result

- Built-in `image_gen` modeで、異なる資産ごとに個別の生成callを実行した。
- `apps/desktop/shared/moods.v1.json` の全30 mood IDと一致するローカルWebPを作成した。
- ムード画像は全て `800x600`（4:3）、品質78、メタデータ除去済み。合計約1.1MB。
- サイドバー静物画は `696x1392`（1:2）、品質80、メタデータ除去済み。
- 生成元PNGはCodex既定の `~/.codex/generated_images/` に保持し、プロジェクト参照先は全てworkspace内へコピー・変換した。

## Final prompt families

- Mood thumbnails: `stylized-concept`、premium dark desktop music app用4:3ムードボード、cinematic fine-art photography、中央に読みやすい主題、160x112 crop safe、dark charcoal / blue-black / restrained earth tone、人物・文字・ロゴ・透かし・UIなし。
- Scene/time: nocturnal water、雨、森、静かな室内、夜行列車、雪、夜明け、朝、黄昏などを、それぞれのcatalog labelに合わせて個別指定。
- Texture: macro material photographyとしてvelvet / glass / paper / mist / wood / metalを個別指定。
- Temperature: ember / sunlight / neutral stone / cool breeze / frost / rain-coolを個別指定。
- Energy: still / breath / flow / steady / drive / sparkを、視覚的な動きの強度が段階的に上がるよう個別指定。
- Sidebar still-life: tall portrait、上半分は暗いnegative space、下部にturntable / amber filament lamp / dark books / trailing plant / black walnut console、文字・ロゴなし。

## Mood assets

| Category | IDs and final paths | Mode | Dimensions | Inspection |
| --- | --- | --- | --- | --- |
| scene | `scene-rainy-window` → `apps/desktop/public/moods/scene-rainy-window.webp`<br>`scene-quiet-library` → `apps/desktop/public/moods/scene-quiet-library.webp`<br>`scene-deep-forest` → `apps/desktop/public/moods/scene-deep-forest.webp`<br>`scene-seaside` → `apps/desktop/public/moods/scene-seaside.webp`<br>`scene-night-train` → `apps/desktop/public/moods/scene-night-train.webp`<br>`scene-snow-room` → `apps/desktop/public/moods/scene-snow-room.webp` | built-in, 6 individual calls | 800x600 WebP each | Pass: 6 distinct scenes, subjects survive thumbnail crop, no text/people/logo |
| time | `time-dawn` → `apps/desktop/public/moods/time-dawn.webp`<br>`time-morning` → `apps/desktop/public/moods/time-morning.webp`<br>`time-noon` → `apps/desktop/public/moods/time-noon.webp`<br>`time-dusk` → `apps/desktop/public/moods/time-dusk.webp`<br>`time-midnight` → `apps/desktop/public/moods/time-midnight.webp`<br>`time-blue-hour` → `apps/desktop/public/moods/time-blue-hour.webp` | built-in, 6 individual calls | 800x600 WebP each | Pass: light progression is legible; midnight/blue-hour remain distinct at thumbnail size |
| texture | `texture-velvet` → `apps/desktop/public/moods/texture-velvet.webp`<br>`texture-glass` → `apps/desktop/public/moods/texture-glass.webp`<br>`texture-paper` → `apps/desktop/public/moods/texture-paper.webp`<br>`texture-mist` → `apps/desktop/public/moods/texture-mist.webp`<br>`texture-wood` → `apps/desktop/public/moods/texture-wood.webp`<br>`texture-metal` → `apps/desktop/public/moods/texture-metal.webp` | built-in, 6 individual calls | 800x600 WebP each | Pass: material surfaces are immediately distinguishable, controlled highlights, no artifacts affecting crop |
| temperature | `temperature-ember` → `apps/desktop/public/moods/temperature-ember.webp`<br>`temperature-sunlight` → `apps/desktop/public/moods/temperature-sunlight.webp`<br>`temperature-neutral` → `apps/desktop/public/moods/temperature-neutral.webp`<br>`temperature-cool-breeze` → `apps/desktop/public/moods/temperature-cool-breeze.webp`<br>`temperature-frost` → `apps/desktop/public/moods/temperature-frost.webp`<br>`temperature-rain-cool` → `apps/desktop/public/moods/temperature-rain-cool.webp` | built-in, 6 individual calls | 800x600 WebP each | Pass: warm-to-cool sequence is visually clear; frost and rain-cool remain distinct |
| energy | `energy-still` → `apps/desktop/public/moods/energy-still.webp`<br>`energy-breath` → `apps/desktop/public/moods/energy-breath.webp`<br>`energy-flow` → `apps/desktop/public/moods/energy-flow.webp`<br>`energy-steady` → `apps/desktop/public/moods/energy-steady.webp`<br>`energy-drive` → `apps/desktop/public/moods/energy-drive.webp`<br>`energy-spark` → `apps/desktop/public/moods/energy-spark.webp` | built-in, 6 individual calls | 800x600 WebP each | Pass: stillness-to-impulse progression reads at 160x120; no typography or UI marks |

## Brand asset

| Asset | Final path | Mode | Dimensions | Inspection |
| --- | --- | --- | --- | --- |
| Studio still-life | `apps/desktop/public/brand/studio-still-life.webp` | built-in, 1 individual call | 696x1392 WebP | Pass: turntable, amber lamp, dark books, plant and black walnut are readable; upper negative space is preserved; no text/logo |

## Verification

- JSON/file ID comparison: catalog 30 IDs == `public/moods/*.webp` 30 basenames (exact diff, GREEN).
- Dimensions: all mood images report `800x600`; sidebar reports `696x1392` (GREEN).
- Format: ImageMagick `identify` reports WebP / 8-bit sRGB for every final asset.
- Uniqueness: all 30 assets were produced from distinct per-ID prompts and individual calls; contact-sheet inspection confirms no duplicate frames.
- Visual QA: inspected every generated full-resolution output, then inspected `/tmp/lyra-moods-contact.webp` at 160x120 thumbnails and the final converted sidebar WebP. The set is coherent, dark, tactile, text-free and readable at the target crop.

## Files intentionally not changed

- No React/TypeScript application code, Rust code, package metadata, or styles were edited by this task.
- No external stock/search imagery was used.
