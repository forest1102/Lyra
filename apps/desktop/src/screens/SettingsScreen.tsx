import { useState } from "react";
import type { TimerPreset } from "../domain";
import { useLyra } from "../state/LyraContext";
import { Button, Card, PageHeader, Screen } from "../ui/components";
import { presetLabel } from "../ui/labels";

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="stack compact"><span className="label">{label}</span><input className="input number" value={value} onChange={(event) => onChange(event.target.value)} type="number" min="1" /></label>;
}

export function SettingsScreen() {
  const { presets, savePreset } = useLyra();
  const [name, setName] = useState("集中 40");
  const [focus, setFocus] = useState("40");
  const [shortBreak, setShortBreak] = useState("8");
  const [longBreak, setLongBreak] = useState("18");
  const [cycles, setCycles] = useState("3");
  const submit = () => {
    const preset: TimerPreset = { id: crypto.randomUUID(), name, focusMinutes: Number(focus), shortBreakMinutes: Number(shortBreak), longBreakMinutes: Number(longBreak), cyclesBeforeLongBreak: Number(cycles), builtIn: false };
    void savePreset(preset);
  };
  return (
    <Screen>
      <PageHeader eyebrow="ローカル実行環境" title="設定" />
      <Card><h2>実行環境の状態</h2><dl className="status-list"><div><dt>Codex App Server</dt><dd className="warning">初回生成時に確認</dd></div><div><dt>WebChucK</dt><dd className="accent">ローカル AudioWorklet</dd></div><div><dt>保存先</dt><dd className="accent">ローカル SQLite</dd></div></dl></Card>
      <Card><h2>カスタムタイマー</h2><div className="row"><input className="input grow" value={name} onChange={(event) => setName(event.target.value)} placeholder="名前" /><NumberField label="集中" value={focus} onChange={setFocus} /><NumberField label="短い休憩" value={shortBreak} onChange={setShortBreak} /><NumberField label="長い休憩" value={longBreak} onChange={setLongBreak} /><NumberField label="サイクル" value={cycles} onChange={setCycles} /><Button label="保存" onClick={submit} disabled={!name.trim()} /></div><p>{presets.map((preset) => `${presetLabel(preset)} ${preset.focusMinutes}/${preset.shortBreakMinutes}`).join(" · ")}</p></Card>
      <Card><h2>MVPの制約</h2><p>外部サンプル、マイク入力、WebChugin、追加UGen、自由プロンプト、ChucKコード編集、クラウド同期は無効です。</p></Card>
    </Screen>
  );
}
