import { cn } from "@/lib/cn";

/** Decorative stroke icon from path data. Always paired with visible text or an aria-label. */
export function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      className={cn("size-5 shrink-0", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
