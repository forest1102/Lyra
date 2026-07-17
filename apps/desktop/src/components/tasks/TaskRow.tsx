import { useSortable } from "@dnd-kit/react/sortable";
import { ChevronDown, ChevronRight, Circle, CircleCheck, GripVertical, Plus, Repeat2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, Tag, Task, UpdateTask } from "../../domain";
import { TaskCombobox } from "./TaskCombobox";
import { TaskDatePicker } from "./TaskDatePicker";
import { TaskTagPicker } from "./TaskTagPicker";

const priorityLabels = { none: "—", low: "低", medium: "中", high: "高" } as const;

export function TaskRow({ task, index, today, projects, tags, subtasks, selected, onSelect, onToggle, onUpdate, onAddSubtask, onToggleSubtask, onUpdateSubtask, onCreateTag, onKeyboardReorder }: {
  task: Task;
  index: number;
  today: string;
  projects: Project[];
  tags: Tag[];
  subtasks: Task[];
  selected: boolean;
  onSelect(): void;
  onToggle(): void;
  onUpdate(input: UpdateTask): void;
  onAddSubtask(title: string): void;
  onToggleSubtask(id: string): void;
  onUpdateSubtask(id: string, input: UpdateTask): void;
  onCreateTag(name: string): Promise<Tag>;
  onKeyboardReorder(direction: -1 | 1): void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(task.notes);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const { ref, handleRef, isDragging } = useSortable({ id: task.id, index, group: task.status, data: { status: task.status } });
  const project = projects.find((candidate) => candidate.id === task.projectId);
  const dateOverdue = task.status !== "completed" && task.dueDate !== null && task.dueDate < today;

  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onKeyboardReorder(event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <article ref={ref} className="task-row-shell" data-dragging={isDragging} data-testid={`task-row-${task.id}`} role="listitem">
        <div className="task-row-grid">
          <button ref={handleRef} type="button" className="task-drag-handle" aria-label={`${task.title}を並べ替え`} onKeyDown={handleReorderKey}>
            <GripVertical aria-hidden="true" />
          </button>
          <Checkbox checked={!task.completed && selected} disabled={task.completed} onCheckedChange={onSelect} aria-label={`${task.title}を集中対象に選択`} />
          <button type="button" className="task-complete-button" aria-label={`${task.title}を${task.completed ? "未完了" : "完了"}にする`} onClick={onToggle}>
            {task.completed ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}
          </button>
          <button type="button" className="task-title-button" onClick={() => setOpen((current) => !current)}>
            <strong data-completed={task.completed}>{task.title}</strong>
            <span>{task.tags.map((tag) => tag.name).join(" · ") || "詳細を開く"}</span>
          </button>
          <TaskCombobox label="プロジェクト" taskTitle={task.title} value={task.projectId} items={projects} onChange={(value) => onUpdate({ projectId: value })} />
          <Badge variant={task.priority === "high" ? "destructive" : task.priority === "none" ? "outline" : "secondary"}>{priorityLabels[task.priority]}</Badge>
          <div className="task-row-dates">
            <TaskDatePicker label="予定日" taskTitle={task.title} value={task.plannedDate} onChange={(value) => onUpdate({ plannedDate: value })} />
            {task.dueDate ? <small data-overdue={dateOverdue}>期限 {task.dueDate.slice(5).replace("-", "/")}</small> : null}
          </div>
          <div className="task-estimate"><span>🍅</span>{task.estimatedPomodoros ?? "—"}</div>
          <CollapsibleTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`${task.title}を${open ? "閉じる" : "展開"}`}>{open ? <ChevronDown /> : <ChevronRight />}</Button>
          </CollapsibleTrigger>
        </div>
        <div className="task-row-meta-mobile">
          {project ? <Badge variant="outline">{project.name}</Badge> : null}
          {task.dueDate ? <Badge variant={dateOverdue ? "destructive" : "outline"}>期限 {task.dueDate.slice(5).replace("-", "/")}</Badge> : null}
          <span>🍅 {task.estimatedPomodoros ?? 0}</span>
        </div>
        <CollapsibleContent>
          <div className="task-expanded">
            <div className="task-expanded-notes">
              <label htmlFor={`notes-${task.id}`}>メモ</label>
              <Textarea id={`notes-${task.id}`} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== task.notes) onUpdate({ notes }); }} placeholder="背景や完了条件を書いておく…" />
              <div className="task-expanded-controls">
                <TaskDatePicker label="期限" value={task.dueDate} onChange={(value) => onUpdate({ dueDate: value })} />
                <TaskTagPicker tags={tags} selectedIds={task.tags.map((tag) => tag.id)} onChange={(tagIds) => onUpdate({ tagIds })} onCreate={onCreateTag} />
                {task.recurrence ? <Badge variant="secondary"><Repeat2 />{task.recurrence}</Badge> : null}
              </div>
            </div>
            <div className="task-subtasks">
              <div className="task-subtasks-heading"><span>サブタスク</span><small>{subtasks.filter((subtask) => subtask.completed).length}/{subtasks.length}</small></div>
              {subtasks.map((subtask) => (
                <div className="task-subtask-row" key={subtask.id}>
                  <button type="button" aria-label={`${subtask.title}を${subtask.completed ? "未完了" : "完了"}にする`} onClick={() => onToggleSubtask(subtask.id)}>{subtask.completed ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}</button>
                  <Input aria-label={`${subtask.title}の名前`} defaultValue={subtask.title} onBlur={(event) => { const title = event.currentTarget.value.trim(); if (title && title !== subtask.title) onUpdateSubtask(subtask.id, { title }); }} />
                </div>
              ))}
              {task.recurrence ? <p className="task-constraint">繰り返しタスクにはサブタスクを追加できません。</p> : (
                <form className="task-subtask-add" onSubmit={(event) => { event.preventDefault(); const clean = subtaskTitle.trim(); if (!clean) return; onAddSubtask(clean); setSubtaskTitle(""); }}>
                  <Input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} aria-label={`${task.title}のサブタスク`} placeholder="サブタスクを追加" />
                  <Button type="submit" size="icon" variant="outline" disabled={!subtaskTitle.trim()} aria-label="サブタスクを追加"><Plus /></Button>
                </form>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}
