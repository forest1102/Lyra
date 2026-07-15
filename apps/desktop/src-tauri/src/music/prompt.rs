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
}

impl GenerationPrompt {
    pub fn new(controls: GenerationControls) -> Self {
        Self { controls }
    }

    pub fn repair(&self, diagnostics: &str) -> String {
        format!(
            "同じスレッドの前回出力を修正してください。\n検証診断: {}\n選択値と音楽的意図を維持し、JSON SchemaとSourcePolicy v1の静的検証契約を満たす修正版JSONだけを返してください。",
            diagnostics
        )
    }
}

fn arrangement_recipe(arrangement: &str) -> &'static str {
    match arrangement {
        "ambient" => "- ambient: BPM 54〜72。2〜8拍の協和パッドと薄い高音パルスを使い、持続低音ドローンは禁止します。",
        "lofi" => "- lofi: BPM 68〜88。柔らかいコード反復と控えめなパルスを使い、重低音キック、強いスネア、歪みは禁止します。",
        "minimal-melody" => "- minimal-melody: BPM 64〜84。3〜7音のメジャー・ペンタトニック動機を使い、警告音のような単音連打は禁止します。",
        _ => "- 未対応の曲調です。音楽を生成せず、制約違反として扱ってください。",
    }
}

fn theme_recipe(theme: &str) -> &'static str {
    match theme {
        "deep-space" => "- deep-space: 中高域のSinOsc/TriOscと短いディレイ。テーマ名を理由に低音化、短調化しません。",
        "rainy-cabin" => "- rainy-cabin: 小音量のNoiseと明るい木質音。雨音を主役にしません。",
        "minimal-pulse" => "- minimal-pulse: 丸めたPulseOsc/SinOscと安定した脈動。刺さる矩形波や警報音を避けます。",
        "organic-drift" => "- organic-drift: 遅いSawOsc/SinOsc変調。音程と和声の中心は固定します。",
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
        write!(
            formatter,
            r#"Lyra向けの明るく穏やかな長時間作業用BGMを1曲生成し、指定JSON SchemaのJSONだけを返してください。

1. 選択値
- theme={theme}
- arrangement={arrangement}
- brightness={brightness}
- density={density}
- motion={motion}

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
0.12 => master.gain;
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
            motion_recipe = motion_recipe(&self.controls.motion),
        )
    }
}
