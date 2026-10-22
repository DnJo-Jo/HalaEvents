import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { navItem } from "./nav";

/** Clearly labelled placeholder for a section whose module is not built yet. */
export function PlannedPage({ href, children }: { href: string; children?: React.ReactNode }) {
  const item = navItem(href);
  return (
    <div className="space-y-8">
      <PageHeader
        title={item.label}
        description={item.summary}
        badge={<Badge tone="neutral">Placeholder · planned for {item.phase}</Badge>}
      />
      <EmptyState
        icon={<Icon path={item.icon} className="size-6" />}
        title={`${item.label} isn’t built yet`}
        description={
          <>
            Nothing is shown here because this module and the database are not connected yet. It is
            scheduled for phase {item.phase} of the implementation plan.
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>What this section will do</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2.5 text-sm">
            {item.planned.map((p) => (
              <li key={p} className="flex gap-2.5">
                <Icon path="M5 12l4 4 10-10" className="mt-0.5 size-4 text-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      {children}
    </div>
  );
}
