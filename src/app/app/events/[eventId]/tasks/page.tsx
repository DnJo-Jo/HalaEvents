import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TaskStatusBadge } from "@/components/workspace/badges";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  addDependencyAction,
  assignTaskAction,
  changeTaskStatusAction,
  createTaskAction,
  removeDependencyAction,
} from "@/modules/tasks/actions";
import { nextStatuses, TASK_STATUS_LABELS, wouldCreateCycle } from "@/modules/tasks/rules";
import { TaskCategory, TaskPriority } from "@/modules/tasks/schemas";
import { getTaskBoard } from "@/modules/tasks/service";

export const metadata: Metadata = { title: "Tasks" };

const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};
const ORIGIN_LABEL = {
  manual: "Added by hand",
  ai_plan: "From AI plan",
  playbook_plan: "From playbook",
};

export default async function TasksPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canEdit, tasks, deps, derived, members, today, progress } =
    await getTaskBoard(eventId);
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const managers = members.filter((m) => m.role !== "viewer");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Tasks"
        description={`${progress.done} of ${progress.total - progress.cancelled} done · ${progress.overdue} overdue · ${progress.blocked} blocked. Dates are calendar days in ${event.timezone}; today is ${today}.`}
      />

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Add a task</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={createTaskAction.bind(null, event.id)}
              resetOnSuccess
              labels={{ title: "Title", dueDate: "Due date", ownerUserId: "Owner" }}
            >
              <FormField label="Title" required>
                <Input name="title" required minLength={3} maxLength={120} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-4">
                <FormField label="Due date">
                  <Input name="dueDate" type="date" />
                </FormField>
                <FormField label="Priority">
                  <Select name="priority" defaultValue="medium">
                    {TaskPriority.options.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Category">
                  <Select name="category" defaultValue="logistics">
                    {TaskCategory.options.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Owner">
                  <Select name="ownerUserId" defaultValue="">
                    <option value="">Nobody yet</option>
                    {managers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField label="Description">
                <Textarea name="description" maxLength={1000} rows={2} />
              </FormField>
              <SubmitButton>Add task</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Accept a plan on the Plan page, or add tasks by hand."
        />
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => {
            const d = derived.get(t.id)!;
            const myDeps = deps.filter((x) => x.task_id === t.id).map((x) => x.depends_on_task_id);
            const candidates = tasks.filter(
              (o) => o.id !== t.id && !myDeps.includes(o.id) && !wouldCreateCycle(deps, t.id, o.id),
            );
            const statuses = nextStatuses(t.status, d.blocked);
            return (
              <li key={t.id}>
                <Card>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="font-medium">{t.title}</h2>
                        {t.description && <p className="text-sm text-ink-muted">{t.description}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <TaskStatusBadge status={t.status} />
                        <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                        {d.blocked && <Badge tone="warning">Blocked</Badge>}
                        {d.overdue && <Badge tone="danger">Overdue</Badge>}
                        {d.dueSoon && <Badge tone="warning">Due soon</Badge>}
                        <Badge>{ORIGIN_LABEL[t.origin]}</Badge>
                      </div>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-ink-muted">Due</dt>
                        <dd>{t.due_date ?? "No deadline"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Owner</dt>
                        <dd>
                          {t.owner_user_id
                            ? (names.get(t.owner_user_id) ?? "A former member")
                            : "Nobody yet"}
                          {t.owner_label && (
                            <span className="text-ink-muted">
                              {" "}
                              · suggested role: {t.owner_label}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Waiting for this</dt>
                        <dd>
                          {d.dependents.length} task{d.dependents.length === 1 ? "" : "s"}
                        </dd>
                      </div>
                    </dl>
                    {myDeps.length > 0 && (
                      <div className="text-sm">
                        <p className="text-xs text-ink-muted">Depends on</p>
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {myDeps.map((depId) => (
                            <li key={depId} className="flex items-center gap-1">
                              <Badge tone={d.blockedBy.includes(depId) ? "warning" : "success"}>
                                {titles.get(depId)} ·{" "}
                                {d.blockedBy.includes(depId) ? "open" : "finished"}
                              </Badge>
                              {canEdit && (
                                <ActionForm
                                  action={removeDependencyAction.bind(null, event.id, t.id, depId)}
                                  className="space-y-0"
                                  aria-label={`Remove dependency on ${titles.get(depId)}`}
                                >
                                  <SubmitButton variant="ghost" size="sm">
                                    Remove
                                  </SubmitButton>
                                </ActionForm>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {canEdit && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-primary">Change task</summary>
                        <div className="mt-3 grid gap-4 sm:grid-cols-3">
                          <ActionForm
                            action={changeTaskStatusAction.bind(null, event.id, t.id)}
                            aria-label={`Status of ${t.title}`}
                          >
                            <FormField
                              label="Status"
                              hint={d.blocked ? "“Done” is unavailable while blocked." : undefined}
                            >
                              <Select name="status" defaultValue={statuses[0]}>
                                {statuses.map((s) => (
                                  <option key={s} value={s}>
                                    {TASK_STATUS_LABELS[s]}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <SubmitButton size="sm" variant="secondary">
                              Update status
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm
                            action={assignTaskAction.bind(null, event.id, t.id)}
                            aria-label={`Owner and deadline of ${t.title}`}
                          >
                            <FormField label="Owner">
                              <Select name="ownerUserId" defaultValue={t.owner_user_id ?? ""}>
                                <option value="">Nobody yet</option>
                                {managers.map((m) => (
                                  <option key={m.user_id} value={m.user_id}>
                                    {m.display_name}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <FormField label="Due date">
                              <Input name="dueDate" type="date" defaultValue={t.due_date ?? ""} />
                            </FormField>
                            <SubmitButton size="sm" variant="secondary">
                              Save
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm
                            action={addDependencyAction.bind(null, event.id, t.id)}
                            aria-label={`Add a dependency to ${t.title}`}
                          >
                            <FormField
                              label="Depends on"
                              hint="Tasks that would create a loop aren't offered."
                            >
                              <Select name="dependsOn" defaultValue="">
                                <option value="">Choose a task</option>
                                {candidates.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.title}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <SubmitButton size="sm" variant="secondary">
                              Add dependency
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
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
