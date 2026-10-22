import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Logo } from "@/components/shell/logo";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6 motion-safe:animate-rise">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardBody className="space-y-6">
            <div className="space-y-1.5 text-center">
              <h1 className="text-xl font-semibold">{title}</h1>
              {description && <div className="text-sm text-ink-muted">{description}</div>}
            </div>
            {children}
          </CardBody>
        </Card>
        {footer && <div className="text-center text-sm text-ink-muted">{footer}</div>}
      </div>
    </main>
  );
}

export function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading form" className="space-y-4">
      <div className="h-10 animate-shimmer rounded-md bg-surface-muted" />
      <div className="h-10 animate-shimmer rounded-md bg-surface-muted" />
      <div className="h-10 animate-shimmer rounded-md bg-surface-muted" />
    </div>
  );
}
