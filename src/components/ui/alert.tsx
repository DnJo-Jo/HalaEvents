import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: string; path: string }> = {
  info: {
    box: "border-info/30 bg-info-soft",
    icon: "text-info",
    path: "M12 8h.01M11 12h1v4h1",
  },
  success: {
    box: "border-success/30 bg-success-soft",
    icon: "text-success",
    path: "m8 12 3 3 5-6",
  },
  warning: {
    box: "border-warning/35 bg-warning-soft",
    icon: "text-warning",
    path: "M12 8v4m0 4h.01",
  },
  danger: { box: "border-danger/30 bg-danger-soft", icon: "text-danger", path: "M12 8v4m0 4h.01" },
};

export interface AlertProps {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Inline message. `danger` uses role="alert" (announced immediately); other tones use role="status".
 */
export function Alert({ tone = "info", title, children, action, className }: AlertProps) {
  const t = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border p-4 text-sm text-ink", t.box, className)}
    >
      <svg
        className={cn("mt-0.5 size-5 shrink-0", t.icon)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d={t.path} />
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-ink-muted">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
