import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TaskList } from "@lyra/domain";
import { useLyra } from "@/state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen, uiStyles } from "@/ui/components";
import { colors } from "@/ui/theme";

export default function TasksScreen() {
  const { tasks, addTask, toggleTask, moveTask } = useLyra();
  const [list, setList] = useState<TaskList>("today");
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const visible = tasks.filter((task) => task.list === list);

  return (
    <Screen>
      <PageHeader eyebrow="作業を整理する" title="タスク" />
      <Card>
        <View style={uiStyles.row}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="次に進めるタスク"
            placeholderTextColor={colors.muted}
            style={[uiStyles.input, { flex: 1 }]}
            onSubmitEditing={() => {
              if (!title.trim()) return;
              void addTask(title, list, estimate ? Number(estimate) : undefined);
              setTitle("");
              setEstimate("");
            }}
          />
          <TextInput
            value={estimate}
            onChangeText={setEstimate}
            keyboardType="number-pad"
            placeholder="🍅"
            placeholderTextColor={colors.muted}
            style={[uiStyles.input, { minWidth: 74, width: 74 }]}
          />
          <Button
            label="追加"
            disabled={!title.trim()}
            onPress={() => {
              void addTask(title, list, estimate ? Number(estimate) : undefined);
              setTitle("");
              setEstimate("");
            }}
          />
        </View>
      </Card>
      <View style={uiStyles.row}>
        <Pill label={`今日 ${tasks.filter((task) => task.list === "today" && !task.completed).length}`} active={list === "today"} onPress={() => setList("today")} />
        <Pill label={`あとで ${tasks.filter((task) => task.list === "backlog" && !task.completed).length}`} active={list === "backlog"} onPress={() => setList("backlog")} />
      </View>
      <Card>
        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={uiStyles.sectionTitle}>ここは空です</Text>
            <Text style={uiStyles.body}>集中したい作業を追加すると、集中画面で複数選択できます。</Text>
          </View>
        ) : visible.map((task) => (
          <Pressable key={task.id} onPress={() => void toggleTask(task.id)} style={styles.task}>
            <View style={[styles.checkbox, task.completed && styles.checkboxDone]}>
              <Text style={{ color: "#10140d" }}>{task.completed ? "✓" : ""}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskTitle, task.completed && styles.taskDone]}>{task.title}</Text>
              {task.estimatedPomodoros ? <Text style={styles.meta}>🍅 × {task.estimatedPomodoros}</Text> : null}
            </View>
            <Button
              label={task.list === "today" ? "→ あとで" : "→ 今日"}
              variant="secondary"
              onPress={() => void moveTask(task.id, task.list === "today" ? "backlog" : "today")}
            />
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  task: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  checkbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  checkboxDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  taskDone: { color: colors.muted, textDecorationLine: "line-through" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  empty: { alignItems: "center", paddingVertical: 52 },
  emptyIcon: { color: colors.accent, fontSize: 32, marginBottom: 12 }
});
