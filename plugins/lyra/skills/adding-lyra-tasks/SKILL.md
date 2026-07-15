---
name: adding-lyra-tasks
description: Use when the user mentions Lyra tasks, asks to add work to Today or Backlog, gives a Pomodoro estimate, or phrases an action item such as 「あとで〜する」 that may belong in Lyra.
---

# Adding Lyra Tasks

## Overview

Interpret task intent and use the Lyra `add_task` tool for additions. Keep writes predictable: explicit requests write immediately; ambiguous action items require confirmation.

## Decision Contract

| User intent | Action |
|---|---|
| Explicitly says Lyraに追加・登録・入れて | Call `add_task` without confirmation. |
| Explicit addition names Today, 今日, or 本日 | Set `list` to `today`. |
| Explicit addition names Backlog, バックログ, or あとでやるタスク | Set `list` to `backlog`. |
| Explicit addition omits the destination | Set `list` to `backlog`; do not ask. |
| Explicit addition omits the estimate | Omit `estimatedPomodoros`; do not ask. |
| 「あとで〜する」「忘れずに〜」など、書き込み意思が曖昧 | Ask whether to add it to Lyra. Do not call the tool until confirmed. |
| Estimate is outside 1–99 or unclear | Ask for a valid estimate before calling the tool. |
| Requests list, completion, editing, or deletion | Explain that the plugin only supports additions. Do not call `add_task`. |

## Build Calls

1. Preserve each task title in the user's wording, removing only surrounding whitespace.
2. Map the destination and optional estimate using the contract above.
3. Call `add_task` once per task. For multiple tasks, keep each task's own destination and estimate.
4. Report the created title and destination. Include the estimate only when set.
5. If a batch partially fails, separate successful and failed tasks in the response; never claim failed writes succeeded.

Tool shape:

```text
add_task({
  title: string,
  list: "today" | "backlog",
  estimatedPomodoros?: integer // 1..99
})
```

## Example

User: `Lyraに「企画書を見直す」を2ポモドーロで追加して`

Call:

```text
add_task({
  title: "企画書を見直す",
  list: "backlog",
  estimatedPomodoros: 2
})
```

Respond with the tool result, for example: `「企画書を見直す」をBacklogに追加しました（2ポモドーロ）。`

## Common Mistakes

- Asking for Today or Backlog after an explicit request omitted the destination. Use `backlog`.
- Defaulting an omitted destination to Today. Use `backlog`.
- Writing an ambiguous action phrase without confirmation. Ask first.
- Sending an omitted estimate as `0` or `null`. Omit the field.
- Simulating unsupported list, completion, editing, or deletion operations. State the limitation.
