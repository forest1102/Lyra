use lyra_core::{LyraError, MusicRecipeV1, ResolvedMusicRecipe};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationControls {
    pub theme: String,
    pub arrangement: String,
    pub brightness: String,
    pub density: String,
    pub motion: String,
}

#[derive(Debug, Clone)]
pub struct GenerationPrompt {
    controls: GenerationControls,
    recipe: Option<ResolvedMusicRecipe>,
}

impl GenerationPrompt {
    pub fn new(controls: GenerationControls) -> Self {
        Self {
            controls,
            recipe: None,
        }
    }

    pub fn from_recipe(recipe: MusicRecipeV1) -> Result<Self, LyraError> {
        let recipe = recipe.resolve()?;
        let level = |value: f64| {
            if value < 0.34 {
                "low"
            } else if value < 0.67 {
                "medium"
            } else {
                "high"
            }
        };
        Ok(Self {
            controls: GenerationControls {
                theme: "mood-alchemy".into(),
                arrangement: recipe.structure_family.clone(),
                brightness: level(recipe.vectors.brightness).into(),
                density: level(recipe.vectors.density).into(),
                motion: level(recipe.vectors.motion).into(),
            },
            recipe: Some(recipe),
        })
    }

    pub fn controls(&self) -> &GenerationControls {
        &self.controls
    }

    pub fn resolved_recipe(&self) -> Option<&ResolvedMusicRecipe> {
        self.recipe.as_ref()
    }

    pub fn repair(&self, diagnostics: &str) -> String {
        format!(
            "{}\n\n前回の出力は検証に失敗しました。診断: {}\n音楽的な意図、7節の品質契約、指定値をすべて維持し、制約を満たす修正版JSONだけを返してください。",
            self, diagnostics
        )
    }
}

fn arrangement_recipe(arrangement: &str) -> &'static str {
    match arrangement {
        "ambient" => "- ambient: BPM 54〜72。2〜8拍の協和パッドと薄い高音パルスを使い、持続低音ドローンは禁止します。",
        "lofi" => "- lofi: BPM 68〜88。柔らかいコード反復と控えめなパルスを使い、重低音キック、強いスネア、歪みは禁止します。",
        "minimal-melody" => "- minimal-melody: BPM 64〜84。3〜7音のメジャー・ペンタトニック動機を使い、警告音のような単音連打は禁止します。",
        "organic-pulse" => "- organic-pulse: BPM 58〜86。木質の短い音と穏やかな呼吸状パルスを組み合わせます。",
        "downtempo" => "- downtempo: BPM 62〜92。丸い低中域パルスと広い和声を使い、強いドラムは禁止します。",
        "neoclassical" => "- neoclassical: BPM 52〜78。疎なペンタトニック旋律と長い協和残響を使います。",
        _ => "- 未対応の曲調です。音楽を生成せず、制約違反として扱ってください。",
    }
}

fn theme_recipe(theme: &str) -> &'static str {
    match theme {
        "deep-space" => "- deep-space: 中高域のSinOsc/TriOscと短いディレイ。テーマ名を理由に低音化、短調化しません。",
        "rainy-cabin" => "- rainy-cabin: 小音量のNoiseと明るい木質音。雨音を主役にしません。",
        "minimal-pulse" => "- minimal-pulse: 丸めたPulseOsc/SinOscと安定した脈動。刺さる矩形波や警報音を避けます。",
        "organic-drift" => "- organic-drift: 遅いSawOsc/SinOsc変調。音程と和声の中心は固定します。",
        "mood-alchemy" => "- mood-alchemy: 正規化済みムードレシピ、構成、テンポ、音色ガイダンスを最優先します。",
        _ => "- 未対応のテーマです。音楽を生成せず、制約違反として扱ってください。",
    }
}

impl fmt::Display for GenerationPrompt {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let recipe_contract = self.recipe.as_ref().map(|recipe| {
            let moods = serde_json::to_string(&recipe.recipe.moods).unwrap_or_else(|_| "[]".into());
            format!(
                "- recipeVersion=1\n- moods={moods}\n- structureFamily={}\n- tempoRange={}-{} BPM\n- timbreGuidance={}\n- normalizedVectors: brightness={:.3}, density={:.3}, motion={:.3}, warmth={:.3}, space={:.3}, pulse={:.3}, melody={:.3}, organic={:.3}",
                recipe.structure_family, recipe.tempo_min, recipe.tempo_max, recipe.timbre_guidance,
                recipe.vectors.brightness, recipe.vectors.density, recipe.vectors.motion,
                recipe.vectors.warmth, recipe.vectors.space, recipe.vectors.pulse,
                recipe.vectors.melody, recipe.vectors.organic,
            )
        }).unwrap_or_else(|| "- recipeVersion=legacy-controls".into());
        write!(
            formatter,
            r#"Lyra向けの長時間作業用BGMを1曲生成してください。

指定:
- theme={theme}
- arrangement={arrangement}
- brightness={brightness}
- density={density}
- motion={motion}
{recipe_contract}

1. 絶対条件
- 明るく穏やかで、十分に聞こえ、注意を奪わないBGMにします。映画的恐怖、サスペンス、暗いドローン、警報音は禁止です。
- 主役はMIDI 55〜79、補助低音もMIDI 48以上に収め、C3未満の持続音を作りません。
- 長調またはメジャー・ペンタトニックを使い、[0,4,7]、[0,2,7]、[0,4,7,9]を中心にします。
- 短2度、トライトーン、半音クラスター、減和音、無調のランダムウォークは禁止です。旋律跳躍は原則完全5度以内です。
- 各音声のGainは0.04〜0.09、ノイズ層は0.01〜0.025、同時発音時の合計は0.10〜0.16を目安にします。

2. コントロール変換表
- brightnessは倍音量とフィルターだけを変えます。low=900〜1800 Hz、medium=1600〜3500 Hz、high=2800〜6000 Hzを目安にします。
- densityはlow=1〜2層、medium=2〜3層、high=3〜4層です。同じ音域へ全層を密集させません。
- motionはlow=4〜8拍、medium=2〜4拍を中心にし、highでも0.5拍未満の連打を避けます。

3. 曲調別レシピ
{arrangement_recipe}
- motionのlow/medium/highは、選択した曲調のBPM範囲の下側/中央/上側へ対応させます。

4. テーマ別レシピ
{theme_recipe}

5. 音響・知覚設計
- 1/fを医学的効果として断定せず、複数時間スケールを持つ相関した微変動として近似します。
- 0.03 / 0.1 / 0.3 Hz相当の緩い変化を重ね、音量は基準値の±6%、フィルターは±12%、パン変化は±0.1以内です。
- 聴覚的粗さを避けるため、30〜200 Hzの高速な振幅・フィルター変調、サイレン、高速ビブラートを禁止します。
- attackは最低0.01秒、パッドは0.2〜2秒を中心とし、releaseは最低0.3秒にします。
- Noiseは最大1層かつ背景レベルに限定し、HPF 120〜250 Hz、LPF 4〜8 kHzを目安に帯域制限します。
- 主役は中央付近、通常のパンは±0.55以内です。8〜32イベントの予測可能なフレーズを基本にします。

6. ChucKコード契約
- 出力は指定JSON Schemaに従うJSONだけにし、titleとdescriptionは日本語で書きます。
- chuckSourceはWebChucKで直接実行できるChucKコードです。先頭付近にMath.srandom(__LYRA_SEED__);をちょうど1回含めます。
- 1〜4個の独立したvoiceループを作り、各while(true)の本体には1〜10000msの数値リテラルによる「duration::unit => now」をちょうど1個だけ含めます。ループのネストと再帰は禁止です。
- 使用可能なクラスはMath、Std、SinOsc、TriOsc、SawOsc、PulseOsc、Blit、Noise、CNoise、ADSR、Envelope、LPF、HPF、BPF、BRF、ResonZ、DelayL、Echo、JCRev、NRev、Chorus、Pan2、Gain、Dynoだけです。
- 最終出力はdacへ接続します。adc、File、FileIO、Machine、MIDI、HID、OSC、SerialIO、SndBuf、LiSa、WaveLoop、WebChugin、動的コード評価は禁止です。
- 外部サンプル、マイク、追加プラグイン、ファイル・ネットワークアクセスは禁止です。
- 次は構造だけの最小例です。音色、音数、周波数、間隔は指定に合わせて設計し直してください。
```chuck
Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
440 => oscillator.freq;
while (true) {{
    envelope.keyOn();
    500::ms => now;
}}
```

7. 出力前セルフチェック
- JSONを返す前に、指定したtheme/arrangement/brightness/density/motion、音域、調性、低域量、音量合計、粗さ、包絡、ノイズ帯域、フレーズ長、ChucK契約を内部で確認します。
- チェック過程や説明文は出力せず、JSONだけを返します。"#,
            theme = self.controls.theme,
            arrangement = self.controls.arrangement,
            arrangement_recipe = arrangement_recipe(&self.controls.arrangement),
            theme_recipe = theme_recipe(&self.controls.theme),
            brightness = self.controls.brightness,
            density = self.controls.density,
            motion = self.controls.motion,
            recipe_contract = recipe_contract,
        )
    }
}
