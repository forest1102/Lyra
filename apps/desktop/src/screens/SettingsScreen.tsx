import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Brain,
  Database,
  FolderOpen,
  Gauge,
  Headphones,
  Laptop,
  Menu,
  Pencil,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { AppSettingsV1, RuntimeDiagnostic, TimerPreset } from "../domain";
import { useLyra } from "../state/LyraContext";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "../components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../components/ui/sheet";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { PageHeader, Screen } from "../ui/components";
import { presetLabel } from "../ui/labels";

type SettingsSection = "general" | "focus" | "audio" | "runtime" | "data";

const sections: Array<{ id: SettingsSection; label: string; icon: typeof Laptop }> = [
  { id: "general", label: "一般", icon: Laptop },
  { id: "focus", label: "集中", icon: Brain },
  { id: "audio", label: "オーディオ", icon: Headphones },
  { id: "runtime", label: "ランタイム", icon: Gauge },
  { id: "data", label: "データ", icon: Database },
];

const diagnosticLabels: Record<RuntimeDiagnostic["component"], string> = {
  codex: "Codex",
  "webchuck-assets": "WebChucKアセット",
  "audio-context": "AudioContext",
  worklet: "Worklet",
  sqlite: "SQLite",
};

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Field orientation="horizontal" className="settings-row">
      <FieldContent>
        <FieldTitle>{title}</FieldTitle>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <div className="settings-control">{children}</div>
    </Field>
  );
}

function PresetDialog({ preset, onSave }: { preset: TimerPreset; onSave: (preset: TimerPreset) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preset);
  const updateNumber = (key: keyof Pick<TimerPreset, "focusMinutes" | "shortBreakMinutes" | "longBreakMinutes" | "cyclesBeforeLongBreak">, value: string) => {
    setDraft((current) => ({ ...current, [key]: Math.max(1, Number(value) || 1) }));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label={`${preset.name}を編集`}><Pencil /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>集中プリセットを編集</DialogTitle>
          <DialogDescription>集中と休憩の長さを分単位で調整します。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor={`preset-name-${preset.id}`}>名前</FieldLabel><Input id={`preset-name-${preset.id}`} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
          <div className="settings-number-grid">
            {([
              ["focusMinutes", "集中"], ["shortBreakMinutes", "短い休憩"],
              ["longBreakMinutes", "長い休憩"], ["cyclesBeforeLongBreak", "サイクル"],
            ] as const).map(([key, label]) => (
              <Field key={key}><FieldLabel htmlFor={`${key}-${preset.id}`}>{label}</FieldLabel><Input id={`${key}-${preset.id}`} type="number" min={1} value={draft[key]} onChange={(event) => updateNumber(key, event.target.value)} /></Field>
            ))}
          </div>
        </FieldGroup>
        <DialogFooter><Button onClick={() => void Promise.resolve(onSave(draft)).then(() => setOpen(false)).catch((error) => toast.error(error instanceof Error ? error.message : "プリセットを保存できませんでした"))} disabled={!draft.name.trim()}>保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsScreen() {
  const lyra = useLyra();
  const [section, setSection] = useState<SettingsSection>("general");
  const [draft, setDraft] = useState<AppSettingsV1>(lyra.settings);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(lyra.settings), [lyra.settings]);
  useEffect(() => {
    if (section !== "runtime") return;
    let disposed = false;
    setDiagnosticsLoading(true);
    void lyra.runtimeDiagnostics().then((result) => {
      if (!disposed) setDiagnostics(result);
    }).catch((error) => {
      if (!disposed) toast.error(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!disposed) setDiagnosticsLoading(false);
    });
    return () => { disposed = true; };
  // Diagnostics are an explicit snapshot. Timer ticks must not retrigger this
  // relatively expensive probe while the runtime section stays open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const hasChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(lyra.settings), [draft, lyra.settings]);
  const save = async () => {
    setSaving(true);
    try {
      await lyra.saveSettings(draft);
      toast.success("設定を保存しました");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "設定を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const content = {
    general: (
      <FieldGroup>
        <SettingRow title="ウィンドウを閉じた時" description="メニューバーで動かし続けるか、アプリを終了するかを選びます。">
          <Select value={draft.closeBehavior} onValueChange={(value) => setDraft((current) => ({ ...current, closeBehavior: value as AppSettingsV1["closeBehavior"] }))}>
            <SelectTrigger aria-label="ウィンドウを閉じた時"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="hide">非表示にする</SelectItem><SelectItem value="quit">終了する</SelectItem></SelectContent>
          </Select>
        </SettingRow>
        <Separator />
        <SettingRow title="ログイン時に起動" description="Macへのログイン後、Lyraを自動で開始します。">
          <Switch checked={draft.launchAtLogin} onCheckedChange={(checked) => setDraft((current) => ({ ...current, launchAtLogin: checked }))} aria-label="ログイン時に起動" />
        </SettingRow>
      </FieldGroup>
    ),
    focus: (
      <FieldGroup>
        <SettingRow title="既定プリセット" description="新しい集中セッションの初期値です。">
          <Select value={draft.defaultPresetId} onValueChange={(value) => setDraft((current) => ({ ...current, defaultPresetId: value }))}>
            <SelectTrigger aria-label="既定プリセット"><SelectValue /></SelectTrigger>
            <SelectContent>{lyra.presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{presetLabel(preset)}</SelectItem>)}</SelectContent>
          </Select>
        </SettingRow>
        <Separator />
        <SettingRow title="休憩を自動で始める" description="集中終了後に確認を待たず休憩へ移ります。"><Switch checked={draft.autoStartBreak} onCheckedChange={(checked) => setDraft((current) => ({ ...current, autoStartBreak: checked }))} aria-label="休憩を自動で始める" /></SettingRow>
        <Separator />
        <SettingRow title="通知" description="フェーズの切り替わりをデスクトップで知らせます。"><Switch checked={draft.notificationsEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, notificationsEnabled: checked }))} aria-label="通知" /></SettingRow>
        <div className="settings-subsection">
          <div><h3>集中プリセット</h3><p>ビルトインは編集せず、カスタムプリセットだけを変更できます。</p></div>
          <div className="settings-items">
            {lyra.presets.map((preset) => (
              <Item key={preset.id}>
                <ItemContent><ItemTitle>{presetLabel(preset)}</ItemTitle><ItemDescription>{preset.focusMinutes}分集中 / {preset.shortBreakMinutes}分休憩</ItemDescription></ItemContent>
                <ItemActions>
                  {preset.builtIn ? <Badge variant="outline">Built-in</Badge> : <>
                    <PresetDialog preset={preset} onSave={lyra.savePreset} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label={`${preset.name}を削除`}><Trash2 /></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>プリセットを削除しますか？</AlertDialogTitle><AlertDialogDescription>「{preset.name}」を削除します。この操作は取り消せません。</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction onClick={() => void Promise.resolve(lyra.deletePreset(preset.id)).catch((error) => toast.error(error instanceof Error ? error.message : "プリセットを削除できませんでした"))}>削除する</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>}
                </ItemActions>
              </Item>
            ))}
          </div>
        </div>
      </FieldGroup>
    ),
    audio: (
      <FieldGroup>
        <SettingRow title="マスター音量" description="Deckを作り直さず、出力Gainへ反映します。">
          <div className="settings-slider">
            <Slider value={[Math.round(draft.masterVolume * 100)]} min={0} max={100} step={1} onValueChange={([value]) => setDraft((current) => ({ ...current, masterVolume: value / 100 }))} aria-label="マスター音量スライダー" />
            <Input aria-label="マスター音量" type="number" min={0} max={100} value={Math.round(draft.masterVolume * 100)} onChange={(event) => setDraft((current) => ({ ...current, masterVolume: Math.min(100, Math.max(0, Number(event.target.value))) / 100 }))} />
            <span>%</span>
          </div>
        </SettingRow>
        <Separator />
        <SettingRow title="集中開始時に選択曲を再生" description="無音を選んだ場合は音楽を再生しません。"><Switch checked={draft.playSelectedTrackOnFocus} onCheckedChange={(checked) => setDraft((current) => ({ ...current, playSelectedTrackOnFocus: checked }))} aria-label="集中開始時に選択曲を再生" /></SettingRow>
        <Separator />
        <SettingRow title="クロスフェード" description="次回以降の曲切り替えに使う時間です。">
          <div className="settings-slider">
            <Slider value={[draft.crossfadeSeconds]} min={0} max={10} step={1} onValueChange={([value]) => setDraft((current) => ({ ...current, crossfadeSeconds: value }))} aria-label="クロスフェードスライダー" />
            <Input aria-label="クロスフェード" type="number" min={0} max={10} value={draft.crossfadeSeconds} onChange={(event) => setDraft((current) => ({ ...current, crossfadeSeconds: Math.min(10, Math.max(0, Number(event.target.value))) }))} />
            <span>秒</span>
          </div>
        </SettingRow>
      </FieldGroup>
    ),
    runtime: (
      <div className="settings-diagnostics" aria-busy={diagnosticsLoading}>
        {diagnosticsLoading ? <p>診断しています…</p> : diagnostics.map((diagnostic) => (
          <Alert key={diagnostic.component} variant={diagnostic.status === "error" ? "destructive" : "default"}>
            <SlidersHorizontal />
            <AlertTitle>{diagnosticLabels[diagnostic.component]} <Badge variant="outline">{diagnostic.status}</Badge></AlertTitle>
            <AlertDescription>{diagnostic.message}{diagnostic.remediation ? <small>{diagnostic.remediation}</small> : null}</AlertDescription>
          </Alert>
        ))}
      </div>
    ),
    data: (
      <Alert>
        <FolderOpen />
        <AlertTitle>ローカルデータ</AlertTitle>
        <AlertDescription>SQLite、生成した.ckファイル、ログを保存するフォルダをFinderで開きます。全データリセットは行いません。</AlertDescription>
        <Button variant="outline" onClick={() => void Promise.resolve(lyra.openDataDirectory()).catch((error) => toast.error(error instanceof Error ? error.message : "データフォルダを開けませんでした"))}><FolderOpen />データフォルダを開く</Button>
      </Alert>
    ),
  }[section];

  const mobileNavigation = (
    <Sheet>
      <SheetTrigger asChild><Button className="settings-mobile-nav" variant="outline" size="icon" aria-label="設定カテゴリを開く"><Menu /></Button></SheetTrigger>
      <SheetContent side="left">
        <SheetHeader><SheetTitle>設定カテゴリ</SheetTitle><SheetDescription>変更する項目を選んでください。</SheetDescription></SheetHeader>
        <nav className="settings-sheet-nav" aria-label="設定カテゴリ">
          {sections.map((item) => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}><item.icon />{item.label}</button>)}
        </nav>
      </SheetContent>
    </Sheet>
  );

  return (
    <Screen className="settings-screen">
      <PageHeader eyebrow="自分のリズムに整える" title="設定" action={mobileNavigation} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="設定カテゴリ">
          {sections.map((item) => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}><item.icon />{item.label}</button>)}
        </nav>
        <section className="settings-panel">
          <header><div><span className="eyebrow">{sections.find((item) => item.id === section)?.label}</span><h2>{section === "runtime" ? "実行環境の状態" : section === "data" ? "データの保存場所" : "環境設定"}</h2></div><Bell className="settings-watermark" /></header>
          {content}
          {section !== "runtime" && section !== "data" ? <div className="settings-save"><Button onClick={() => void save()} disabled={!hasChanges || saving}><Save />{saving ? "保存中…" : "設定を保存"}</Button></div> : null}
        </section>
      </div>
    </Screen>
  );
}
