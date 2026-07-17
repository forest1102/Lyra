import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Card as ShadcnCard } from "@/components/ui/card";

export function Screen({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <main className={`screen ${className}`.trim()}>{children}</main>;
}

export function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
      {action}
    </header>
  );
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <ShadcnCard className={`card ${className}`.trim()}>{children}</ShadcnCard>;
}

export function Button({
  label,
  variant = "primary",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const shadcnVariant = variant === "danger" ? "destructive" : variant === "secondary" ? "secondary" : "default";
  return <ShadcnButton className={`button button-${variant}`} variant={shadcnVariant} {...props}>{label}</ShadcnButton>;
}

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <ShadcnButton type="button" variant="outline" className={`pill ${active ? "pill-active" : ""}`} aria-pressed={active} onClick={onPress}>{label}</ShadcnButton>;
}
