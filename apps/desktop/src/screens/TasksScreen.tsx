import { arrayMove } from "@dnd-kit/helpers";
import { DragDropProvider, KeyboardSensor, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { CalendarDays, Inbox, ListChecks, Menu, Plus, Search, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { AddTaskV2, Task, TaskPriority, TaskRecurrence, TaskStatus } from "../domain";
import { TaskCombobox } from "../components/tasks/TaskCombobox";
import { TaskDatePicker } from "../components/tasks/TaskDatePicker";
import { TaskRow } from "../components/tasks/TaskRow";
import { TaskRail, type TaskView } from "../components/tasks/TaskRail";
import { useLyra } from "../state/LyraContext";
import "./TasksScreen.css";

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function filterTasksForView(tasks: Task[], view: TaskView, today: string): Task[] {
  return tasks
    .filter((task) => task.parentId === null)
    .filter((task) => {
      if (view.kind === "inbox") return task.status === "inbox";
      if (view.kind === "completed") return task.status === "completed";
      if (task.status === "completed") return false;
      if (view.kind === "project") return task.projectId === view.projectId;
      if (view.kind === "today") return task.plannedDate === today || (task.dueDate !== null && task.dueDate < today);
      return (task.plannedDate !== null && task.plannedDate > today) || (task.dueDate !== null && task.dueDate > today);
    })
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
}

export function reorderIdsInStatus(tasks: Task[], sourceId: string, targetId: string, status: TaskStatus): string[] | null {
  const scope = tasks.filter((task) => task.status === status)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
  const from = scope.findIndex((task) => task.id === sourceId);
  const to = scope.findIndex((task) => task.id === targetId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove(scope, from, to).map((task) => task.id);
}

function viewTitle(view: TaskView, projectName?: string): string {
  if (view.kind === "inbox") return "Inbox";
  if (view.kind === "today") return "今日";
  if (view.kind === "upcoming") return "近日";
  if (view.kind === "completed") return "完了";
  return projectName ?? "Project";
}

function statusForView(view: TaskView): TaskStatus {
  return view.kind === "today" || view.kind === "upcoming" ? "active" : view.kind === "completed" ? "completed" : "inbox";
}

export function TasksScreen({ today = localDateKey(), onStartFocus }: { today?: string; onStartFocus?: () => void } = {}) {
  const lyra = useLyra();
  const [view, setView] = useState<TaskView>({ kind: "inbox" });
  const [railOpen, setRailOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [plannedDate, setPlannedDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const projectName = view.kind === "project" ? lyra.projects.find((project) => project.id === view.projectId)?.name : undefined;
  const visibleTasks = useMemo(() => filterTasksForView(lyra.tasks, view, today), [lyra.tasks, today, view]);
  const selectedFocusTasks = lyra.tasks.filter((task) => !task.completed && lyra.selectedTaskIds.includes(task.id));
  const selectedFocusTotal = selectedFocusTasks.reduce((total, task) => total + (task.estimatedPomodoros ?? 0), 0);
  const canStartFocus = lyra.timer.phase === "focus" && (lyra.timer.status === "idle" || lyra.timer.status === "completed");
  const effectivePlannedDate = view.kind === "today" ? today : plannedDate;
  const recurrenceNeedsDate = view.kind !== "completed" && recurrence !== null && effectivePlannedDate === null && dueDate === null;
  const upcomingNeedsFutureDate = view.kind === "upcoming" && !((effectivePlannedDate !== null && effectivePlannedDate > today) || (dueDate !== null && dueDate > today));

  const taskError = (error: unknown) => toast.error(error instanceof Error ? error.message : "タスクを更新できませんでした");

  const changeView = (nextView: TaskView) => {
    setView(nextView);
    setRailOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || recurrenceNeedsDate || upcomingNeedsFutureDate) return;
    const input: AddTaskV2 = {
      title: cleanTitle,
      status: statusForView(view),
      priority,
      estimatedPomodoros: estimate ? Math.max(1, Math.min(99, Number(estimate))) : null,
      projectId: view.kind === "project" ? view.projectId : projectId,
      plannedDate: effectivePlannedDate,
      dueDate,
      recurrence: view.kind === "completed" ? null : recurrence,
      tagIds: [],
    };
    setIsAdding(true);
    try {
      await lyra.addTaskV2(input);
      setTitle("");
      setEstimate("");
      setPriority("none");
      setPlannedDate(null);
      setDueDate(null);
      setRecurrence(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "タスクを追加できませんでした");
    } finally {
      setIsAdding(false);
    }
  };

  const reorder = (sourceId: string, targetId: string) => {
    const source = visibleTasks.find((task) => task.id === sourceId);
    const target = visibleTasks.find((task) => task.id === targetId);
    if (!source || !target || source.status !== target.status) return;
    const ids = reorderIdsInStatus(lyra.tasks, sourceId, targetId, source.status);
    if (!ids) return;
    void lyra.reorderTasks(ids, source.status).catch(taskError);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;
    const sourceId = event.operation.source?.id;
    const targetId = event.operation.target?.id;
    if (sourceId === undefined || targetId === undefined) return;
    reorder(String(sourceId), String(targetId));
  };

  const keyboardReorder = (id: string, direction: -1 | 1) => {
    const source = visibleTasks.find((task) => task.id === id);
    if (!source) return;
    const scope = visibleTasks.filter((task) => task.status === source.status);
    const index = scope.findIndex((task) => task.id === id);
    const target = scope[index + direction];
    if (target) reorder(id, target.id);
  };

  const rail = <TaskRail view={view} projects={lyra.projects} tasks={lyra.tasks} today={today} onChange={changeView} onCreateProject={async (name) => { await lyra.saveProject({ id: "", name, color: null, position: lyra.projects.length }); }} />;

  return (
    <main className="tasks-screen">
      <aside className="tasks-rail">{rail}</aside>
      <section className="tasks-main">
        <header className="tasks-header">
          <div className="tasks-header-title">
            <Sheet open={railOpen} onOpenChange={setRailOpen}>
              <SheetTrigger asChild>
                <Button className="tasks-rail-trigger" size="icon" variant="outline" aria-label="タスクリストを開く"><Menu /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="tasks-rail-sheet">
                <SheetHeader><SheetTitle>タスクリスト</SheetTitle></SheetHeader>
                {rail}
              </SheetContent>
            </Sheet>
            <div>
              <p>作業を整理する</p>
              <h1>{viewTitle(view, projectName)}</h1>
            </div>
          </div>
          <div className="tasks-search"><Search aria-hidden="true" /><span>{visibleTasks.length} tasks</span></div>
        </header>

        <form className="task-quick-add" onSubmit={submit}>
          <Plus aria-hidden="true" />
          <Input aria-label="新しいタスク" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="タスクを追加…" />
          <Input className="task-estimate-input" aria-label="見積Pomodoro" value={estimate} onChange={(event) => setEstimate(event.target.value)} type="number" min="1" max="99" placeholder="🍅" />
          <Button type="button" variant="ghost" onClick={() => setShowDetails((current) => !current)} aria-expanded={showDetails}>詳細</Button>
          <Button type="submit" disabled={!title.trim() || recurrenceNeedsDate || upcomingNeedsFutureDate || isAdding}>{isAdding ? "追加中…" : "追加"}</Button>
          {showDetails ? (
            <div className="task-quick-details">
              <TaskCombobox label="プロジェクト" value={projectId} items={lyra.projects} onChange={setProjectId} />
              <TaskDatePicker label="予定日" value={plannedDate} onChange={setPlannedDate} />
              <TaskDatePicker label="期限" value={dueDate} onChange={setDueDate} />
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger aria-label="優先度"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="none">優先度なし</SelectItem><SelectItem value="low">低</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="high">高</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
              {view.kind !== "completed" ? <Select value={recurrence ?? "none"} onValueChange={(value) => setRecurrence(value === "none" ? null : value as TaskRecurrence)}>
                <SelectTrigger aria-label="繰り返し"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="none">繰り返しなし</SelectItem><SelectItem value="daily">毎日</SelectItem><SelectItem value="weekly">毎週</SelectItem><SelectItem value="monthly">毎月</SelectItem>
                </SelectGroup></SelectContent>
              </Select> : null}
              {recurrenceNeedsDate ? <p className="task-quick-warning" role="status">繰り返しタスクには予定日または期限が必要です</p> : null}
              {upcomingNeedsFutureDate ? <p className="task-quick-warning" role="status">近日のタスクには今日より後の予定日または期限が必要です</p> : null}
            </div>
          ) : null}
        </form>

        <div className="task-list-heading" aria-hidden="true">
          <span /><span /><span /><span>タスク</span><span>Project</span><span>優先度</span><span>予定 / 期限</span><span>見積</span><span />
        </div>
        <ScrollArea className="tasks-scroll">
          {visibleTasks.length === 0 ? (
            <Empty className="tasks-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon">{view.kind === "completed" ? <ListChecks /> : <Inbox />}</EmptyMedia>
                <EmptyTitle>ここにはまだ何もありません</EmptyTitle>
                <EmptyDescription>上の入力欄から、次に進めるタスクを追加できます。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <DragDropProvider sensors={[PointerSensor, KeyboardSensor]} onDragEnd={handleDragEnd}>
              <div className="task-list" role="list">
                {visibleTasks.map((task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={visibleTasks.slice(0, index).filter((candidate) => candidate.status === task.status).length}
                    today={today}
                    projects={lyra.projects}
                    tags={lyra.tags}
                    subtasks={lyra.tasks.filter((candidate) => candidate.parentId === task.id)}
                    selected={lyra.selectedTaskIds.includes(task.id)}
                    onSelect={() => lyra.selectTask(task.id)}
                    onToggle={() => void lyra.toggleTask(task.id).catch(taskError)}
                    onUpdate={(input) => void lyra.updateTask(task.id, input).catch(taskError)}
                    onAddSubtask={(subtaskTitle) => void lyra.addTaskV2({ title: subtaskTitle, status: task.status === "completed" ? "inbox" : task.status, parentId: task.id, projectId: task.projectId, recurrence: null }).catch(taskError)}
                    onToggleSubtask={(id) => void lyra.toggleTask(id).catch(taskError)}
                    onUpdateSubtask={(id, input) => void lyra.updateTask(id, input).catch(taskError)}
                    onCreateTag={(name) => lyra.saveTag({ id: "", name })}
                    onKeyboardReorder={(direction) => keyboardReorder(task.id, direction)}
                  />
                ))}
              </div>
            </DragDropProvider>
          )}
        </ScrollArea>

        <footer className="tasks-selection-bar" data-visible={selectedFocusTasks.length > 0}>
          <div><strong>{selectedFocusTasks.length}件を選択</strong><span>{canStartFocus ? `合計 ${selectedFocusTotal} Pomodoro` : "休憩終了後に開始できます"}</span></div>
          <Button disabled={selectedFocusTasks.length === 0 || !canStartFocus} onClick={() => void lyra.dispatchTimer({ type: "start", nowMs: Date.now() }).then(() => onStartFocus?.()).catch((error) => toast.error(error instanceof Error ? error.message : "集中を開始できませんでした"))}>
            <Sparkles data-icon="inline-start" />選んだタスクで集中
          </Button>
        </footer>
      </section>
    </main>
  );
}
