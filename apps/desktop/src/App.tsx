import { useState } from "react";
import { AppSidebar, type ScreenId } from "./components/AppSidebar";
import { Toaster } from "./components/ui/sonner";
import { Spinner } from "./components/ui/spinner";
import { TooltipProvider } from "./components/ui/tooltip";
import { FocusScreen } from "./screens/FocusScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StudioScreen } from "./screens/StudioScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { useLyra } from "./state/LyraContext";
import { Button } from "./ui/components";

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
    <TooltipProvider>
      <div className="app-shell">
        <AppSidebar active={active} onNavigate={setActive} onStopMusic={() => void stopMusic()} />
        <div className="content">
          {active === "tasks" ? <TasksScreen onStartFocus={() => setActive("focus")} /> : <ActiveScreen />}
        </div>
      </div>
    </TooltipProvider>
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
  if (!lyra.ready) return <div className="center-state" aria-live="polite"><Spinner className="size-5 text-primary" />Lyraを読み込んでいます…</div>;
  return (
    <>
      {lyra.subscriptionError || lyra.musicError ? <div className="error-stack">
        {lyra.subscriptionError ? (
          <div className="error-banner" role="alert">
            <span>イベントを購読できませんでした: {lyra.subscriptionError}</span>
            <Button label="再接続" onClick={lyra.retrySubscriptions} />
          </div>
        ) : null}
        {lyra.musicError ? <div className="error-banner" role="alert">{lyra.musicError}</div> : null}
      </div> : null}
      <App />
      <Toaster theme="dark" position="bottom-right" richColors />
    </>
  );
}
