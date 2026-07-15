import { useState, type FormEvent } from "react";
import type { TaskList } from "../domain";
import { useLyra } from "../state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen } from "../ui/components";

export function TasksScreen() {
  const { tasks, addTask, toggleTask, moveTask } = useLyra();
  const [list, setList] = useState<TaskList>("today");
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const visible = tasks.filter((task) => task.list === list);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void addTask(title, list, estimate ? Number(estimate) : undefined);
    setTitle("");
    setEstimate("");
  };

  return (
    <Screen>
      <PageHeader eyebrow="作業を整理する" title="タスク" />
      <Card>
        <form className="row" onSubmit={submit}>
          <input className="input grow" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="次に進めるタスク" />
          <input className="input estimate" value={estimate} onChange={(event) => setEstimate(event.target.value)} type="number" min="1" max="99" placeholder="🍅" />
          <Button label="追加" type="submit" disabled={!title.trim()} />
        </form>
      </Card>
      <div className="row">
        <Pill label={`今日 ${tasks.filter((task) => task.list === "today" && !task.completed).length}`} active={list === "today"} onPress={() => setList("today")} />
        <Pill label={`あとで ${tasks.filter((task) => task.list === "backlog" && !task.completed).length}`} active={list === "backlog"} onPress={() => setList("backlog")} />
      </div>
      <Card>
        {visible.length === 0 ? <div className="empty"><span className="empty-glyph">✓</span><h2>ここは空です</h2><p>集中したい作業を追加すると、集中画面で複数選択できます。</p></div> : visible.map((task) => (
          <div className="task-row" key={task.id}>
            <button className={`checkbox ${task.completed ? "checkbox-done" : ""}`} aria-label={`${task.title}を${task.completed ? "未完了" : "完了"}にする`} onClick={() => void toggleTask(task.id)}>{task.completed ? "✓" : ""}</button>
            <div className="grow"><strong className={task.completed ? "done" : ""}>{task.title}</strong>{task.estimatedPomodoros ? <small>🍅 × {task.estimatedPomodoros}</small> : null}</div>
            <Button label={task.list === "today" ? "→ あとで" : "→ 今日"} variant="secondary" onClick={() => void moveTask(task.id, task.list === "today" ? "backlog" : "today")} />
          </div>
        ))}
      </Card>
    </Screen>
  );
}
