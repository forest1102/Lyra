import { cn } from "@/lib/utils";

export function LyraMark({ className, title = "Lyra" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-10", className)}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 18c4 5 4 20 2 27m18-27c-4 5-4 20-2 27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M23 22c6 3 12 3 18 0M24 44c5 3 11 3 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M28 24v19m4-18v19m4-20v19" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity=".86" />
      <path d="m48 11 .9 2.7 2.8.9-2.8.9-.9 2.7-.9-2.7-2.8-.9 2.8-.9.9-2.7Z" fill="currentColor" />
    </svg>
  );
}
