import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  "neutral" | "primary" | "info" | "success" | "warning" | "danger" | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-line",
  primary: "bg-primary-soft text-primary border-primary/25",
  info: "bg-info-soft text-info border-info/25",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/25",
  accent: "bg-accent-soft text-accent border-accent/25",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Status label. Never rely on color alone: the text must carry the meaning. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Marks rows produced by a mock integration (`is_mock = true`). */
export function MockBadge() {
  return (
    <Badge tone="warning" title="Produced by a mock integration, not a real provider">
      Mock
    </Badge>
  );
}

/** Marks sample content that is not real or persisted data. */
export function DemoBadge({ children = "Demo content" }: { children?: React.ReactNode }) {
  return <Badge tone="accent">{children}</Badge>;
}
