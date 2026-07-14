import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { TimerPreset } from "@lyra/domain";
import { useLyra } from "@/state/LyraContext";
import { Button, Card, PageHeader, Screen, uiStyles } from "@/ui/components";
import { colors } from "@/ui/theme";
import { presetLabel } from "@/ui/labels";

export default function SettingsScreen() {
  const { presets, savePreset } = useLyra();
  const [name, setName] = useState("集中 40");
  const [focus, setFocus] = useState("40");
  const [shortBreak, setShortBreak] = useState("8");
  const [longBreak, setLongBreak] = useState("18");
  const [cycles, setCycles] = useState("3");

  const submit = () => {
    const preset: TimerPreset = {
      id: crypto.randomUUID(),
      name,
      focusMinutes: Number(focus),
      shortBreakMinutes: Number(shortBreak),
      longBreakMinutes: Number(longBreak),
      cyclesBeforeLongBreak: Number(cycles),
      builtIn: false
    };
    void savePreset(preset);
  };

  return (
    <Screen>
      <PageHeader eyebrow="ローカル実行環境" title="設定" />
      <Card>
        <Text style={uiStyles.sectionTitle}>実行環境の状態</Text>
        <View style={[uiStyles.row, { justifyContent: "space-between" }]}>
          <Text style={uiStyles.body}>Codex App Server</Text><Text style={{ color: colors.warning }}>初回生成時に確認</Text>
        </View>
        <View style={[uiStyles.row, { justifyContent: "space-between", marginTop: 12 }]}>
          <Text style={uiStyles.body}>SuperCollider</Text><Text style={{ color: colors.warning }}>互換性確認が必要</Text>
        </View>
        <View style={[uiStyles.row, { justifyContent: "space-between", marginTop: 12 }]}>
          <Text style={uiStyles.body}>保存先</Text><Text style={{ color: colors.accent }}>ローカル SQLite</Text>
        </View>
      </Card>
      <Card>
        <Text style={uiStyles.sectionTitle}>カスタムタイマー</Text>
        <View style={uiStyles.row}>
          <TextInput value={name} onChangeText={setName} style={[uiStyles.input, { flex: 1 }]} placeholder="名前" placeholderTextColor={colors.muted} />
          <LabeledNumber label="集中" value={focus} onChange={setFocus} />
          <LabeledNumber label="短い休憩" value={shortBreak} onChange={setShortBreak} />
          <LabeledNumber label="長い休憩" value={longBreak} onChange={setLongBreak} />
          <LabeledNumber label="サイクル" value={cycles} onChange={setCycles} />
          <Button label="保存" onPress={submit} disabled={!name.trim()} />
        </View>
        <Text style={[uiStyles.body, { marginTop: 14 }]}>{presets.map((preset) => `${presetLabel(preset)} ${preset.focusMinutes}/${preset.shortBreakMinutes}`).join(" · ")}</Text>
      </Card>
      <Card>
        <Text style={uiStyles.sectionTitle}>MVPの制約</Text>
        <Text style={uiStyles.body}>外部サンプル、マイク、Quarks、追加UGen、自由プロンプト、SCコード編集、クラウド同期は無効です。</Text>
      </Card>
    </Screen>
  );
}

function LabeledNumber({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={uiStyles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="number-pad" style={[uiStyles.input, { minWidth: 82, width: 94 }]} />
    </View>
  );
}
