# Task 6 report: Music Alchemy screen

## Outcome

Phase 2のMusic Alchemy UIを、旧theme/arrangement/intensity入力からversion付き`MusicRecipeV1`中心の画面へ刷新した。

- 左: `情景 / 時間帯 / 質感 / 温度 / エネルギー`のToggleGroupと、分類ごとのローカルWebP 6枚
- 中央: 既存Canvas 2D `MoodOrb`、オーブポイントによる重み調整、選択から融合へ向かう光跡
- 右: ムード名・割合・Slider・融合した印象文・生成/検証/保存状態
- 既定3ムードは均等配分。選択変更時も均等配分し、1〜5件を強制
- Slider/オーブでの変更は正規化し、各ムード1%以上かつ合計1を維持
- 生成時は正規化済み`{ version: 1, moods }`だけを`generateTrack`へ送信
- 生成進捗、生成中止、エラーAlert、Skeleton/Spinner/Progress、Sonner通知を実装
- 生成完了後は自動再生せず、明示的な`検証して再生`から5秒検証へ進む
- 検証合格後だけ保存可能。集中中の延期はタイマーを操作せず説明と無効ボタンを表示
- reduced-motionでは光跡を停止し、静的なムードラベル帯へ置換
- 1180×780と900×620を想定した専用3カラム/短高レスポンシブCSSを追加

## Files

- `apps/desktop/src/screens/StudioScreen.tsx`
- `apps/desktop/src/screens/StudioScreen.test.tsx`
- `apps/desktop/src/screens/StudioScreen.css`
- `apps/desktop/src/components/music-alchemy/MoodBoard.tsx`
- `apps/desktop/src/components/music-alchemy/MusicRecipePanel.tsx`

## TDD evidence

最初に7件の画面テストを追加し、旧画面に対して7件すべてが期待どおり失敗することを確認した。その後実装してGREEN化した。さらにSliderのアクセシブル名と極端な重みの下限について、それぞれ失敗テストを確認してから修正した。

最終focused result:

```text
apps/desktop/src/screens/StudioScreen.test.tsx
9 tests passed
```

関連テスト:

```text
StudioScreen + moodCatalog + MoodOrb + musicGeneration
4 files / 19 tests passed
```

全frontend test実行時は、Studioを含む19ファイル108件が成功した。並行実装中の`TasksScreen.test.tsx`だけが2件失敗し、Radix Select用pointer-capture polyfill不足によるunhandled errorが1件あった。

## Verification

- `bunx vitest run --root ../.. apps/desktop/src/screens/StudioScreen.test.tsx`: PASS（9件）
- 関連4ファイル: PASS（19件）
- `bun run build`: PASS（2931 modules transformed）
- `git diff --check`（Studio担当tracked files）: PASS
- `bun run typecheck`: Studio関連エラーなし。並行実装中`LibraryScreen`の2件で全体はFAIL
- `bun run test`: Studio関連PASS。並行実装中`TasksScreen`の2件のみFAIL

## Self-review

- 旧`MUSIC_THEMES`、`MUSIC_ARRANGEMENTS`、`LegacyMusicGenerationRequest`の画面依存は除去済み。
- 生の画面色や`space-x/y`は追加していない。カタログ由来の色は既存どおりCSS custom propertyとしてCanvas/ムード識別にだけ利用する。
- `Slider`がRadix Thumbへアクセシブル名を転送しないため、画面専用ラッパーで実体Thumbへラベルを付与した。
- コミットは作成していない。
