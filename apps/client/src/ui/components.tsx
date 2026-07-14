import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

export function Screen({ children }: PropsWithChildren) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      <View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.65 }
      ]}
    >
      <Text style={[styles.buttonText, variant === "primary" && { color: "#11170b" }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export const uiStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  split: { flexDirection: "row", gap: 18, flexWrap: "wrap" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 13,
    paddingVertical: 11,
    minWidth: 180
  }
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: 30, gap: 18, maxWidth: 1180, width: "100%", alignSelf: "center" },
  pageHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1.8, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1.2, marginTop: 4 },
  card: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 20 },
  button: { minHeight: 42, borderRadius: 10, paddingHorizontal: 17, alignItems: "center", justifyContent: "center" },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: "#3a1e28", borderWidth: 1, borderColor: "#663142" },
  buttonText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  pill: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 8 },
  pillActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  pillText: { color: colors.muted, fontWeight: "600" }
});
