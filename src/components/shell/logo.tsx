import Link from "next/link";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={cn("size-7", className)} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M10 9v14M22 9v14M10 16h12"
        className="stroke-primary-ink"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="22" cy="9" r="2.6" className="fill-accent" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md font-semibold text-ink",
        className,
      )}
    >
      <LogoMark />
      <span className="text-[1.05rem] tracking-tight">HalaEvents</span>
    </Link>
  );
}
