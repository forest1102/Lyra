import { Tabs } from "expo-router";
import { Platform, Text } from "react-native";
import { colors } from "@/ui/theme";

const icons: Record<string, string> = {
  focus: "◉",
  tasks: "✓",
  studio: "♫",
  library: "▤",
  settings: "⚙"
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarPosition: Platform.OS === "web" ? "left" : "bottom",
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.sidebar,
          borderColor: colors.border,
          width: Platform.OS === "web" ? 188 : undefined,
          paddingTop: Platform.OS === "web" ? 28 : 0
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 18 }}>{icons[route.name] ?? "•"}</Text>
        )
      })}
    >
      <Tabs.Screen name="focus" options={{ title: "集中" }} />
      <Tabs.Screen name="tasks" options={{ title: "タスク" }} />
      <Tabs.Screen name="studio" options={{ title: "BGM制作" }} />
      <Tabs.Screen name="library" options={{ title: "ライブラリ" }} />
      <Tabs.Screen name="settings" options={{ title: "設定" }} />
    </Tabs>
  );
}
