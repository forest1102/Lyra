use lyra_core::{LyraError, MusicRecipeV1, ResolvedMusicRecipe};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fmt;

const MAX_REPAIR_DIAGNOSTICS_BYTES: usize = 384;
const ELLIPSIS: &str = "…";

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
        let diagnostics = truncate_repair_diagnostics(diagnostics);
        format!(
            "同じスレッドの前回出力を修正してください。\n検証診断: {}\n選択値と音楽的意図を維持し、JSON SchemaとSourcePolicy v1の静的検証契約を満たす修正版JSONだけを返してください。",
            diagnostics
        )
    }
}

fn truncate_repair_diagnostics(diagnostics: &str) -> Cow<'_, str> {
    if diagnostics.len() <= MAX_REPAIR_DIAGNOSTICS_BYTES {
        return Cow::Borrowed(diagnostics);
    }

    let mut end = MAX_REPAIR_DIAGNOSTICS_BYTES - ELLIPSIS.len();
    while !diagnostics.is_char_boundary(end) {
        end -= 1;
    }
    Cow::Owned(format!("{}{}", &diagnostics[..end], ELLIPSIS))
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

fn brightness_recipe(brightness: &str) -> &'static str {
    match brightness {
        "low" => "- brightness=low: 倍音量とLPFを900〜1800 Hz中心にします。",
        "medium" => "- brightness=medium: 倍音量とLPFを1600〜3500 Hz中心にします。",
        "high" => "- brightness=high: 倍音量とLPFを2800〜6000 Hz中心にします。",
        _ => "- 未対応のbrightnessです。音楽を生成せず、制約違反として扱ってください。",
    }
}

fn density_recipe(density: &str) -> &'static str {
    match density {
        "low" => "- density=low: 1〜2層にし、音域を重ねすぎません。",
        "medium" => "- density=medium: 2〜3層にし、音域を分離します。",
        "high" => "- density=high: 3〜4層にし、同じ音域へ密集させません。",
        _ => "- 未対応のdensityです。音楽を生成せず、制約違反として扱ってください。",
    }
}

fn motion_recipe(motion: &str) -> &'static str {
    match motion {
        "low" => "- motion=low: 4〜8拍中心、曲調BPM範囲の下側を使います。",
        "medium" => "- motion=medium: 2〜4拍中心、曲調BPM範囲の中央を使います。",
        "high" => "- motion=high: 0.5拍未満の連打を避け、曲調BPM範囲の上側を使います。",
        _ => "- 未対応のmotionです。音楽を生成せず、制約違反として扱ってください。",
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
            r#"Lyra向けの明るく穏やかな長時間作業用BGMを1曲生成し、指定JSON SchemaのJSONだけを返してください。

1. 選択値
- theme={theme}
- arrangement={arrangement}
- brightness={brightness}
- density={density}
- motion={motion}
{recipe_contract}

2. 静的検証必須契約
- chuckSourceはWebChucKで実行でき、SourcePolicy::v1().validateに必ず合格するコードにします。
- Math.srandom(__LYRA_SEED__);をちょうど1回含めます。
- 1〜4個の独立したwhile (true) voice loopを作ります。各loop本体の時間進行は1〜10000msの数値リテラルによるduration::unit => nowをちょうど1回だけにします。loopのネストと再帰は禁止です。
- 許可クラスはMath, Std, SinOsc, TriOsc, SawOsc, PulseOsc, Blit, Noise, CNoise, ADSR, Envelope, LPF, HPF, BPF, BRF, ResonZ, DelayL, Echo, JCRev, NRev, Chorus, Pan2, Gain, Dynoだけです。
- dacへ接続します。adc, File, FileIO, Machine, MidiIn, MidiOut, HidIn, HidOut, OscIn, OscOut, SerialIO, SndBuf, LiSa, WaveLoop, KBHit, me, chout, cherrと、許可外クラスは禁止です。
- 外部I/O（ファイル、ネットワーク、マイク、MIDI、HID、OSC、Serial、外部サンプル、追加プラグイン、動的コード評価）は禁止です。
- titleとdescriptionは日本語にし、説明やチェック過程を出力しません。

3. 選択された音楽レシピ
{arrangement_recipe}
{theme_recipe}
{brightness_recipe}
{density_recipe}
{motion_recipe}

4. 音響品質
- 十分に聞こえ、注意を奪わない音にします。映画的恐怖、サスペンス、暗いドローン、警報音は禁止です。
- 主役はMIDI 55〜79、補助低音もMIDI 48以上とし、C3未満の持続音を作りません。
- 長調またはメジャー・ペンタトニックを使い、[0,4,7]、[0,2,7]、[0,4,7,9]を中心にします。短2度、トライトーン、半音クラスター、減和音、無調ランダムウォークは禁止し、旋律跳躍は原則完全5度以内です。
- 各音声のGainは0.04〜0.09、ノイズ層は0.01〜0.025、同時発音時の合計は0.10〜0.16を目安にします。
- 1/fを医学的効果として断定せず、複数時間スケールを持つ相関した微変動として近似します。
- 0.03 / 0.1 / 0.3 Hz相当の緩い変化を重ね、音量は基準値の±6%、フィルターは±12%、パン変化は±0.1以内です。
- 聴覚的粗さを避けるため、30〜200 Hzの高速な振幅・フィルター変調、サイレン、高速ビブラートを禁止します。
- attackは最低0.01秒、パッドは0.2〜2秒を中心とし、releaseは最低0.3秒にします。
- Noiseは最大1層かつ背景レベルに限定し、HPF 120〜250 Hz、LPF 4〜8 kHzを目安に帯域制限します。
- 主役は中央付近、通常のパンは±0.55以内です。8〜32イベントの予測可能なフレーズを基本にします。

5. 検証済みChucK例
次はSourcePolicy::v1().validateを通る2 voice並行構造例です。音色、音程、間隔は選択値に合わせて設計し直してください。
```chuck
Math.srandom(__LYRA_SEED__);
SinOsc texture => ADSR textureEnv => LPF filter => Gain master => dac;
TriOsc lead => ADSR leadEnv => Pan2 leadPan => master;
0.05 => texture.gain;
0.05 => lead.gain;
1.0 => master.gain;
330 => texture.freq;
523 => lead.freq;
fun void textureVoice() {{
    while (true) {{
        textureEnv.keyOn();
        2000::ms => now;
    }}
}}
spork ~ textureVoice();
while (true) {{
    leadEnv.keyOn();
    1000::ms => now;
}}
```
JSONを返す前に選択値、音域、調性、音量、変調、SourcePolicy契約を内部確認し、JSONだけを返してください。"#,
            theme = self.controls.theme,
            arrangement = self.controls.arrangement,
            arrangement_recipe = arrangement_recipe(&self.controls.arrangement),
            theme_recipe = theme_recipe(&self.controls.theme),
            brightness = self.controls.brightness,
            brightness_recipe = brightness_recipe(&self.controls.brightness),
            density = self.controls.density,
            density_recipe = density_recipe(&self.controls.density),
            motion = self.controls.motion,
            recipe_contract = recipe_contract,
            motion_recipe = motion_recipe(&self.controls.motion),
        )
    }
}
