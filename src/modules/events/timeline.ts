import { z } from "zod";

/** One row of event_timeline() (migration 0007): whitelisted details only. */
export const TimelineEntry = z.object({
  at: z.string(),
  actor_kind: z.string(),
  actor_name: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

const human = (s: unknown) => String(s ?? "").replace(/_/g, " ");
const quoted = (s: unknown) => (s ? `“${String(s)}”` : "");

/** Plain-language sentence for a timeline entry (actor shown separately). */
export function describeTimelineEntry(e: TimelineEntry): string {
  const d = e.details;
  const title = quoted(d.title);
  const changed = d.from !== undefined && d.to !== undefined && d.from !== d.to;
  switch (e.entity_type) {
    case "events":
      if (e.action === "insert") return `created the event ${title}`;
      return changed
        ? `moved the event from ${human(d.from)} to ${human(d.to)}`
        : "updated the event";
    case "event_members":
      return e.action === "delete" ? "removed a member" : `added a member as ${human(d.role)}`;
    case "tasks":
      if (e.action === "insert") return `added task ${title}`;
      if (e.action === "delete") return `deleted task ${title}`;
      if (changed) return `moved task ${title} from ${human(d.from)} to ${human(d.to)}`;
      if (d.owner_changed) return `changed the owner of ${title}`;
      if (d.due_to !== undefined || d.due_from !== undefined)
        return `changed the deadline of ${title} to ${d.due_to ?? "none"}`;
      return `updated task ${title}`;
    case "task_dependencies":
      return e.action === "delete" ? "removed a task dependency" : "added a task dependency";
    case "ai_plans":
      if (e.action === "insert")
        return d.source === "ai"
          ? "generated a plan proposal (AI)"
          : "created a plan from the playbook (no AI)";
      return changed ? `marked a plan ${human(d.to)}` : "updated a plan";
    case "ai_suggestions":
      return changed
        ? `${d.to === "accepted" ? "accepted" : d.to === "rejected" ? "dismissed" : `marked ${human(d.to)}`} a suggestion`
        : "updated a suggestion";
    case "compliance_checks":
      if (e.action === "insert") return `opened compliance check ${title}`;
      return changed
        ? `moved compliance check ${title} from ${human(d.from)} to ${human(d.to)}`
        : `updated compliance check ${title}`;
    case "compliance_evidence":
      return `recorded ${d.simulated ? "simulated " : ""}evidence (${human(d.kind)})`;
    case "compliance_references":
      return e.action === "delete" ? "removed a source reference" : "referenced an official source";
    case "official_submissions":
      return d.to === "response_recorded"
        ? "recorded a simulated official response (demonstration)"
        : "recorded a simulated official submission (demonstration)";
    default:
      return `${e.action} ${human(e.entity_type)}`;
  }
}
