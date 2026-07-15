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
        _ => "- 未対応の曲調です。音楽を生成せず、制約違反として扱ってください。",
    }
}

fn theme_recipe(theme: &str) -> &'static str {
    match theme {
        "deep-space" => "- deep-space: 中高域のSinOsc/LFTriと短いディレイ。テーマ名を理由に低音化、短調化しません。",
        "rainy-cabin" => "- rainy-cabin: 小音量のPinkNoiseと明るい木質音。雨音を主役にしません。",
        "minimal-pulse" => "- minimal-pulse: 丸めたPulse/SinOscと安定した脈動。刺さる矩形波や警報音を避けます。",
        "organic-drift" => "- organic-drift: 遅いVarSaw/SinOsc変調。音程と和声の中心は固定します。",
        _ => "- 未対応のテーマです。音楽を生成せず、制約違反として扱ってください。",
    }
}

impl fmt::Display for GenerationPrompt {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            r#"Lyra向けの長時間作業用BGMを1曲生成してください。

指定:
- theme={theme}
- arrangement={arrangement}
- brightness={brightness}
- density={density}
- motion={motion}

1. 絶対条件
- 明るく穏やかで、十分に聞こえ、注意を奪わないBGMにします。映画的恐怖、サスペンス、暗いドローン、警報音は禁止です。
- 主役はMIDI 55〜79、補助低音もMIDI 48以上に収め、C3未満の持続音を作りません。
- 長調またはメジャー・ペンタトニックを使い、[0,4,7]、[0,2,7]、[0,4,7,9]を中心にします。
- 短2度、トライトーン、半音クラスター、減和音、無調のランダムウォークは禁止です。旋律跳躍は原則完全5度以内とし、ルート、長3度、完全5度へ定期的に戻します。
- ピッチにPwhiteとPbrownを使わず、許可したmidinoteだけをPseqまたはPxrandで選びます。
- 各音声のampは0.04〜0.09、ノイズ層は0.01〜0.025、同時発音時の指定amp合計は0.10〜0.16を目安にします。

2. コントロール変換表
- brightnessは倍音量とフィルターだけを変え、音高や調性を暗くしません。low=900〜1800 Hz、medium=1600〜3500 Hz、high=2800〜6000 Hzを目安にします。
- densityはlow=1〜2層、medium=2〜3層、high=3〜4層です。同じ音域へ全層を密集させません。
- motionはlow=4〜8拍、medium=2〜4拍を中心にし、highでも0.5拍未満の連打を避けます。

3. 曲調別レシピ
{arrangement_recipe}
- motionのlow/medium/highは、選択した曲調のBPM範囲の下側/中央/上側へ対応させます。

4. テーマ別レシピ
{theme_recipe}

5. 音響・知覚設計
- 1/fを医学的効果として断定せず、複数時間スケールを持つ相関した微変動として近似します。PinkNoiseの音色と時間方向の1/f風変動を混同しません。
- LFNoise1.krを0.03 / 0.1 / 0.3 Hzで重ね、寄与を概ね0.5 / 0.3 / 0.2にします。音量は基準値の±6%、フィルターは±12%、パン変化は±0.1以内です。音程、調性、コード構成音には適用しません。
- 発音間隔は独立乱数にせず、4〜16イベント単位で相関する±3%以内の変化にします。
- 聴覚的粗さを避けるため、30〜200 Hzの高速な振幅・フィルター変調、サイレン、高速ビブラート、リング変調風の音を禁止します。
- attackは最低0.01秒、パッドは0.2〜2秒を中心とし、releaseは最低0.3秒にします。全レイヤーを同時に強く立ち上げません。
- 広帯域ノイズは最大1層かつ背景レベルに限定し、HPF 120〜250 Hz、LPF 4〜8 kHzを目安に帯域制限します。低域の濁り、高域の連続ヒス、鋭い共振を避けます。
- 主役は中央付近、通常のパンは±0.55以内、パン変調は0.1 Hz以下にします。左右端への張り付きと急移動を禁止します。
- 8〜32イベントの予測可能なフレーズを基本とし、8〜16イベントごとに音色・音量・間隔の1項目だけを微変化させます。完全ランダム化、突然の長い休符、急な密度上昇は禁止です。

6. SuperColliderコード契約
- 出力は指定JSON Schemaに従うJSONだけにし、titleとdescriptionは日本語で書きます。
- supercolliderSourceは評価時に再生やファイル操作を起こさず、~lyraTrackへsynthDefsとpatternを持つEventを代入します。
- SynthDefは1〜4個、名前は\lyra_voice_1〜\lyra_voice_4とし、すべてout/amp/gate/panとEnvGen/Done.freeSelfを持たせます。
- 音高は明示的な\midinote配列で指定します。未許可のScale.majorセレクタは使いません。
- 使用可能なクラスはSinOsc、LFSaw、LFTri、Pulse、VarSaw、Formant、Blip、WhiteNoise、PinkNoise、BrownNoise、ClipNoise、Dust、Dust2、LFNoise0、LFNoise1、LFNoise2、Env、EnvGen、Line、XLine、Lag、Lag2、Lag3、Decay2、LPF、HPF、BPF、BRF、RLPF、RHPF、Resonz、Ringz、OnePole、LeakDC、DelayN、DelayL、DelayC、CombN、CombL、CombC、AllpassN、AllpassL、AllpassC、FreeVerb、FreeVerb2、Pan2、Balance2、Splay、SynthDef、Out、Mix、Scale、Rest、Done、Pbind、Ppar、Pseq、Prand、Pxrand、Pwrand、Pwhite、Pexprand、Pbrown、Pseries、Pgeom、Pn、Pstutter、Pdup、Pkeyだけです。
- 使用可能なセレクタは.ar、.kr、.ir、.asr、.perc、.freeSelf、.midicps、.midiratio、.dbamp、.clip、.range、.exprange、.linexp、.roundだけです。
- 許可UGen・Patternだけを使い、Pfunc、Plazy、SoundIn、In、DiskIn、BufRd、GVerb、Buffer、Server、File、Routine、fork、.add、.playは使いません。
- 外部サンプル、マイク、Quarks、追加プラグイン、\out/\groupのPattern指定は禁止です。durは0.0625〜32、ampは0〜0.2に収め、Patternは無限に継続させます。
- 次は構造だけの最小例です。この形を守り、音色、音数、\midinoteと\durの配列は選択された曲調・テーマ・各コントロールに合わせて設計し直してください。
```supercollider
(
~lyraTrack = (
  synthDefs: [
    SynthDef(\lyra_voice_1, {{ |out=0, amp=0.06, gate=1, pan=0, freq=440|
      var env = EnvGen.kr(Env.asr(0.2, 1, 1.5), gate, doneAction: Done.freeSelf);
      var sig = LPF.ar(SinOsc.ar(freq), 3200);
      Out.ar(out, Pan2.ar(sig, pan) * amp * env);
    }})
  ],
  pattern: Pbind(
    \instrument, \lyra_voice_1,
    \dur, Pseq([1, 2, 1, 4], inf),
    \midinote, Pseq([60, 64, 67, 69], inf),
    \amp, 0.06
  )
);
)
```

7. 出力前セルフチェック
- JSONを返す前に、指定したtheme/arrangement/brightness/density/motion、音域、調性、禁止音程、低域量、amp合計、1/f風変動幅、粗さ、包絡、ノイズ帯域、フレーズ長、SuperCollider契約を内部で確認します。
- チェック過程や説明文は出力せず、JSONだけを返します。"#,
            theme = self.controls.theme,
            arrangement = self.controls.arrangement,
            arrangement_recipe = arrangement_recipe(&self.controls.arrangement),
            theme_recipe = theme_recipe(&self.controls.theme),
            brightness = self.controls.brightness,
            density = self.controls.density,
            motion = self.controls.motion,
        )
    }
}
