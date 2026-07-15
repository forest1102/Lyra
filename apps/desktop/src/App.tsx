import { useState } from "react";
import { FocusScreen } from "./screens/FocusScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StudioScreen } from "./screens/StudioScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { useLyra } from "./state/LyraContext";
import { Button } from "./ui/components";

type ScreenId = "focus" | "tasks" | "studio" | "library" | "settings";

const destinations: Array<{ id: ScreenId; label: string; icon: string }> = [
  { id: "focus", label: "集中", icon: "◉" },
  { id: "tasks", label: "タスク", icon: "✓" },
  { id: "studio", label: "BGM制作", icon: "♫" },
  { id: "library", label: "ライブラリ", icon: "▤" },
  { id: "settings", label: "設定", icon: "⚙" }
];

const screens: Record<ScreenId, () => React.JSX.Element> = {
  focus: FocusScreen,
  tasks: TasksScreen,
  studio: StudioScreen,
  library: LibraryScreen,
  settings: SettingsScreen
};

export function App() {
  const [active, setActive] = useState<ScreenId>("focus");
  const { stopMusic } = useLyra();
  const ActiveScreen = screens[active];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✦</span><span>Lyra</span></div>
        <nav aria-label="メインナビゲーション">
          {destinations.map((destination) => (
            <button
              key={destination.id}
              className={`nav-item ${active === destination.id ? "nav-item-active" : ""}`}
              aria-current={active === destination.id ? "page" : undefined}
              onClick={() => setActive(destination.id)}
            >
              <span aria-hidden="true">{destination.icon}</span>{destination.label}
            </button>
          ))}
        </nav>
        <button className="nav-item stop-music" onClick={() => void stopMusic()}>
          <span aria-hidden="true">■</span>音楽停止
        </button>
        <p className="sidebar-caption">LOCAL FOCUS COMPANION</p>
      </aside>
      <div className="content"><ActiveScreen /></div>
    </div>
  );
}

export function AppGate() {
  const lyra = useLyra();
  if (lyra.startupError) {
    return (
      <div className="center-state" role="alert">
        <h1>Lyraを起動できませんでした</h1>
        <p>{lyra.startupError}</p>
        <Button label="再試行" onClick={() => void lyra.retryStartup()} />
      </div>
    );
  }
  if (!lyra.ready) return <div className="center-state" aria-live="polite">Lyraを読み込んでいます…</div>;
  return (
    <>
      {lyra.musicError ? <div className="error-banner" role="alert">{lyra.musicError}</div> : null}
      <App />
    </>
  );
}
