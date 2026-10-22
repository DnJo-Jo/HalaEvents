import { cn } from "@/lib/cn";

/** Decorative placeholder block. Wrap groups in an element with role="status" and a label. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-shimmer rounded-md bg-surface-muted", className)}
    />
  );
}
