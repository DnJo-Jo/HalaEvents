import { COMPUTED_RISK_TITLES } from "./engine";
import type { AiFullPlanDraft, AiPlanDraft, PlanOutput, TaskProposal } from "./schemas";

/**
 * Planning agent, deterministic half (event.md §17.7–17.8): turns a validated model draft into a
 * PlanOutput. Hybrid drafts (`draftToPlan`) take budget amounts, the schedule, requirements and
 * missing information from the playbook engine (`base`); full drafts (`fullDraftToPlan`) take them
 * from the model and are checked by `fullPlanErrors`. Evidence ids outside the
 * catalog and dependencies on unknown tasks are removed here; everything else (duplicate ids,
 * cycles, URLs, dates) is left for validatePlan to reject.
 */

const uniq = (items: string[], max: number) => {
  const seen = new Set<string>();
  return items
    .filter((s) => {
      const k = s.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
};

export function draftToPlan(
  draft: AiPlanDraft,
  base: PlanOutput,
  evidence: Map<string, string>,
): PlanOutput {
  const tasks = draftTasks(draft, evidence);
  const computed = new Set<string>(Object.values(COMPUTED_RISK_TITLES));
  return {
    summary: draft.summary,
    goals: draft.goals.length ? draft.goals : base.goals,
    requirements: base.requirements,
    missingInformation: base.missingInformation,
    decisions: uniq([...draft.decisions, ...base.decisions], 20),
    followUpQuestions: draft.followUpQuestions.length
      ? draft.followUpQuestions
      : base.followUpQuestions,
    budgetCategories: base.budgetCategories,
    budgetSummary: base.budgetSummary,
    risks: [...draft.risks, ...base.risks.filter((r) => computed.has(r.title))].slice(0, 20),
    schedule: base.schedule,
    tasks,
    assumptions: uniq([...draft.assumptions, ...base.assumptions], 20),
    conflicts: draft.conflicts,
  };
}

/** Model tasks → proposals: unknown evidence ids and dependencies are dropped, nothing else. */
function draftTasks(draft: AiPlanDraft, evidence: Map<string, string>): TaskProposal[] {
  const ids = new Set(draft.tasks.map((t) => t.id));
  return draft.tasks.map((t) => ({
    tempId: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    due: {
      type: "relative",
      anchor: t.anchor === "end" ? "event_end" : "event_start",
      offsetDays: t.offsetDays,
      date: "",
    },
    proposedOwner: t.owner,
    dependsOn: [...new Set(t.dependsOn)].filter((d) => d !== t.id && ids.has(d)),
    requiredInfo: [],
    evidenceIds: [...new Set(t.evidence)].filter((e) => evidence.has(e)),
    confidence: t.confidence,
    uncertainty: "",
    nextAction: t.nextAction,
  }));
}

/**
 * Full custom draft (AI_PLAN_STRATEGY=full): every part of the plan comes from the model; code
 * only cleans references (as above) and caps list lengths. Validation follows in the service.
 */
export function fullDraftToPlan(draft: AiFullPlanDraft, evidence: Map<string, string>): PlanOutput {
  return {
    summary: draft.summary,
    goals: draft.goals,
    requirements: draft.requirements,
    missingInformation: draft.missingInformation,
    decisions: uniq(draft.decisions, 20),
    followUpQuestions: draft.followUpQuestions,
    budgetCategories: draft.budgetCategories,
    budgetSummary: draft.budgetSummary,
    risks: draft.risks,
    schedule: draft.schedule,
    tasks: draftTasks(draft, evidence),
    assumptions: uniq(draft.assumptions, 20),
    conflicts: draft.conflicts,
  };
}
