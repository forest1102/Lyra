import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LyraProvider } from "@/state/LyraContext";

export default function RootLayout() {
  return (
    <LyraProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </LyraProvider>
  );
}
