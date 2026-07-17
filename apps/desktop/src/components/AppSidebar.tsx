import { CircleStop, FlaskConical, Focus, Library, ListTodo, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { LyraMark } from "./LyraMark";

export type ScreenId = "focus" | "tasks" | "studio" | "library" | "settings";

const destinations: Array<{ id: ScreenId; label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  { id: "focus", label: "集中", icon: Focus },
  { id: "tasks", label: "タスク", icon: ListTodo },
  { id: "studio", label: "Music Alchemy", icon: FlaskConical },
  { id: "library", label: "ライブラリ", icon: Library },
  { id: "settings", label: "設定", icon: Settings },
];

export function AppSidebar({
  active,
  musicGenerating = false,
  onNavigate,
  onStopMusic,
}: {
  active: ScreenId;
  musicGenerating?: boolean;
  onNavigate: (destination: ScreenId) => void;
  onStopMusic: () => void;
}) {
  return (
    <aside className="sidebar" style={{ "--sidebar-art": "url('/brand/studio-still-life.webp')" } as React.CSSProperties}>
      <div className="brand">
        <LyraMark className="brand-mark" />
        <span>Lyra</span>
      </div>
      <nav aria-label="メインナビゲーション">
        {destinations.map((destination) => {
          const Icon = destination.icon;
          const showGeneration = destination.id === "studio" && musicGenerating;
          const button = (
            <button
              key={destination.id}
              type="button"
              className={`nav-item ${active === destination.id ? "nav-item-active" : ""}`}
              aria-label={destination.label}
              aria-current={active === destination.id ? "page" : undefined}
              onClick={() => onNavigate(destination.id)}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span className="nav-label">{destination.label}</span>
              {showGeneration ? (
                <span className="nav-generation">
                  <Spinner className="size-3.5" aria-label="音楽を生成中" />
                  <span className="nav-generation-label">生成中</span>
                </span>
              ) : null}
            </button>
          );
          return (
            <Tooltip key={destination.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{destination.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="nav-item stop-music" aria-label="音楽を停止" onClick={onStopMusic}>
            <CircleStop className="size-5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span>音楽を停止</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">音楽を停止</TooltipContent>
      </Tooltip>
      <p className="sidebar-caption">LOCAL FOCUS COMPANION</p>
    </aside>
  );
}
