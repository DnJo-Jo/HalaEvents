import { Badge, type BadgeTone } from "@/components/ui/badge";
import { COMPLIANCE_STATUS } from "@/modules/compliance/rules";
import type { ComplianceStatus } from "@/modules/compliance/schemas";
import { TASK_STATUS_LABELS } from "@/modules/tasks/rules";
import type { TaskStatus } from "@/modules/tasks/schemas";

const TASK_TONE: Record<TaskStatus, BadgeTone> = {
  todo: "neutral",
  in_progress: "info",
  done: "success",
  cancelled: "neutral",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONE[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

export function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  const s = COMPLIANCE_STATUS[status];
  return (
    <Badge tone={s.tone} title={s.meaning}>
      {s.label}
    </Badge>
  );
}

/** Marks demonstration-only records (simulated official submissions/responses). */
export function SimulatedBadge() {
  return (
    <Badge
      tone="warning"
      title="Demonstration only: nothing was sent to or received from any authority"
    >
      Simulated · demo
    </Badge>
  );
}
