import { CalendarDays, CheckCheck, Inbox, Layers3, Plus, Sun } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project, Task } from "../../domain";

export type TaskView =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "completed" }
  | { kind: "project"; projectId: string };

function active(view: TaskView, kind: TaskView["kind"], projectId?: string): boolean {
  return view.kind === kind && (kind !== "project" || (view.kind === "project" && view.projectId === projectId));
}

export function TaskRail({ view, projects, tasks, today, onChange, onCreateProject }: {
  view: TaskView;
  projects: Project[];
  tasks: Task[];
  today: string;
  onChange(view: TaskView): void;
  onCreateProject(name: string): Promise<void>;
}) {
  const [addingProject, setAddingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const topLevel = tasks.filter((task) => task.parentId === null);
  const count = (kind: TaskView["kind"], projectId?: string) => topLevel.filter((task) => {
    if (kind === "inbox") return task.status === "inbox";
    if (kind === "completed") return task.status === "completed";
    if (kind === "project") return task.status !== "completed" && task.projectId === projectId;
    if (task.status === "completed") return false;
    if (kind === "today") return task.plannedDate === today || Boolean(task.dueDate && task.dueDate < today);
    return Boolean((task.plannedDate && task.plannedDate > today) || (task.dueDate && task.dueDate > today));
  }).length;
  const navItems = [
    { kind: "inbox" as const, label: "Inbox", icon: Inbox },
    { kind: "today" as const, label: "今日", icon: Sun },
    { kind: "upcoming" as const, label: "近日", icon: CalendarDays },
    { kind: "completed" as const, label: "完了", icon: CheckCheck },
  ];

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    try {
      await onCreateProject(name);
      setProjectName("");
      setAddingProject(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "プロジェクトを作成できませんでした");
    }
  };

  return (
    <nav className="task-rail-nav" aria-label="タスクの表示">
      <p className="task-rail-kicker">TASKS</p>
      <div className="task-rail-group">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.kind}
              className="task-rail-item"
              variant={active(view, item.kind) ? "secondary" : "ghost"}
              aria-label={item.label}
              aria-current={active(view, item.kind) ? "page" : undefined}
              onClick={() => onChange({ kind: item.kind })}
            >
              <Icon data-icon="inline-start" /><span>{item.label}</span><small>{count(item.kind)}</small>
            </Button>
          );
        })}
      </div>
      <div className="task-rail-section-title"><Layers3 aria-hidden="true" /><span>Projects</span><Button type="button" size="icon-sm" variant="ghost" aria-label="プロジェクトを追加" onClick={() => setAddingProject((current) => !current)}><Plus /></Button></div>
      {addingProject ? <form className="task-project-add" onSubmit={(event) => void createProject(event)}><Input autoFocus aria-label="プロジェクト名" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="新しいProject" /><Button type="submit" size="sm" disabled={!projectName.trim()}>作成</Button></form> : null}
      <ScrollArea className="task-projects-scroll">
        <div className="task-rail-group">
          {projects.map((project) => (
            <Button
              key={project.id}
              className="task-rail-item"
              variant={active(view, "project", project.id) ? "secondary" : "ghost"}
              aria-current={active(view, "project", project.id) ? "page" : undefined}
              onClick={() => onChange({ kind: "project", projectId: project.id })}
            >
              <span className="task-project-dot" aria-hidden="true" /><span>{project.name}</span><small>{count("project", project.id)}</small>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </nav>
  );
}
