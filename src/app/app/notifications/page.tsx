import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import { markReadAction } from "@/modules/notifications/actions";
import type { NotificationKind } from "@/modules/notifications/repo";
import { listMyNotifications } from "@/modules/notifications/service";

export const metadata: Metadata = { title: "Notifications" };

const KIND: Record<NotificationKind, [string, BadgeTone]> = {
  missing_information: ["Missing information", "warning"],
  compliance_concern: ["Possible compliance concern", "danger"],
  deadline_approaching: ["Deadline", "warning"],
  decision_required: ["Decision needed", "primary"],
  compliance_status_changed: ["Compliance status changed", "info"],
};

export default async function NotificationsPage() {
  const items = await listMyNotifications();
  const unread = items.filter((n) => n.delivery_status !== "read").length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="In-app only: HalaEvents does not send these by email or push. “Delivered” means it is in this inbox."
        actions={
          unread > 0 ? (
            <ActionForm action={markReadAction.bind(null, null)} className="space-y-0">
              <SubmitButton variant="secondary" size="sm">
                Mark all {unread} as read
              </SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Reminders and decisions for your events appear here."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const [label, tone] = KIND[n.kind];
            return (
              <li key={n.id}>
                <Card className={n.delivery_status === "read" ? "opacity-75" : undefined}>
                  <CardBody className="flex flex-wrap items-start justify-between gap-3 text-sm">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={tone}>{label}</Badge>
                        <Badge>
                          {n.delivery_status === "read" ? "Read" : "Delivered · unread"}
                        </Badge>
                      </div>
                      <p className="font-medium">
                        {n.link_path ? (
                          <Link href={n.link_path} className="text-primary hover:underline">
                            {n.title}
                          </Link>
                        ) : (
                          n.title
                        )}
                      </p>
                      {n.body && <p className="text-ink-muted">{n.body}</p>}
                      <p className="text-xs text-ink-muted">
                        {formatInZone(n.created_at, "Asia/Dubai")}
                      </p>
                    </div>
                    {n.delivery_status !== "read" && (
                      <ActionForm action={markReadAction.bind(null, n.id)} className="space-y-0">
                        <SubmitButton variant="ghost" size="sm">
                          Mark read
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
