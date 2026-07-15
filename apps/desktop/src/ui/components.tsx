import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

export function Screen({ children }: PropsWithChildren) {
  return <main className="screen">{children}</main>;
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
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function Button({
  label,
  variant = "primary",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  return <button className={`button button-${variant}`} {...props}>{label}</button>;
}

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <button className={`pill ${active ? "pill-active" : ""}`} aria-pressed={active} onClick={onPress}>{label}</button>;
}
