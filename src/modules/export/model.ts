import { formatInZone } from "@/lib/dates";
import type { EventRow } from "@/modules/events/repo";
import type { PlanOverview } from "@/modules/planning/schemas";
import { TASK_STATUS_LABELS } from "@/modules/tasks/rules";
import type { TaskRow } from "@/modules/tasks/repo";
import type { ShortlistedVendor } from "@/modules/vendors/schemas";
import { SERVICE_LABELS } from "@/modules/vendors/schemas";

/**
 * Pure mapping from persisted event data to the five worksheets of the spreadsheet export
 * (event.md §16.6). Nothing is derived or invented: a missing value stays empty, and plan amounts
 * keep their "unverified estimate" label. No AI and no provider call is involved.
 */

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  /** Column headers; empty for the key/value overview. */
  headers: string[];
  rows: Cell[][];
  /** Shown above the table when there is nothing to list. */
  emptyNote: string;
  /** Column indexes (0-based) holding money. */
  currencyColumns?: number[];
  /** Column widths in characters. */
  widths: number[];
}
export interface ExportModel {
  fileName: string;
  currency: string;
  eventBudget: number | null;
  sheets: {
    overview: Sheet;
    tasks: Sheet;
    budget: Sheet;
    schedule: Sheet;
    vendors: Sheet;
  };
}

export interface ExportInput {
  event: EventRow;
  tasks: TaskRow[];
  dependencies: { task_id: string; depends_on_task_id: string }[];
  members: { user_id: string; display_name: string }[];
  /** The current saved plan's overview, when there is one. */
  overview: PlanOverview | null;
  planSource: "ai" | "playbook" | null;
  shortlist: ShortlistedVendor[];
  exportedAt: Date;
}

const SOURCE_LABELS = { ai: "Custom draft", playbook: "Template" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export function exportFileName(name: string, exportedAt: Date): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50) || "event";
  return `halaevents-${slug}-${exportedAt.toISOString().slice(0, 10)}.xlsx`;
}

export function buildExportModel(input: ExportInput): ExportModel {
  const { event, overview } = input;
  const tz = event.timezone;
  const names = new Map(input.members.map((m) => [m.user_id, m.display_name]));
  const titles = new Map(input.tasks.map((t) => [t.id, t.title]));
  const budgetCurrency = event.currency;

  const overviewRows: Cell[][] = [
    ["Event name", event.name],
    ["Event type", cap(event.event_type)],
    ["Status", cap(event.status)],
    ["Starts", formatInZone(event.starts_at, tz)],
    ["Ends", formatInZone(event.ends_at, tz)],
    ["Time zone", tz],
    ["Venue type", event.venue_type ? cap(event.venue_type) : null],
    ["Location", event.location_text],
    ["City", event.city],
    ["Country", event.country],
    ["Expected attendance (capacity)", event.capacity],
    [
      "Event budget",
      event.budget_amount === null ? null : `${event.budget_amount} ${budgetCurrency}`,
    ],
    [
      "Services needed",
      event.services.length ? event.services.map((s) => SERVICE_LABELS[s]).join(", ") : null,
    ],
    ["Plan", input.planSource ? SOURCE_LABELS[input.planSource] : null],
    ["Plan summary", overview?.summary ?? null],
    ["Exported", formatInZone(input.exportedAt.toISOString(), tz)],
  ];

  const taskRows: Cell[][] = input.tasks.map((t) => {
    const after = input.dependencies
      .filter((d) => d.task_id === t.id)
      .map((d) => titles.get(d.depends_on_task_id))
      .filter((x): x is string => Boolean(x));
    return [
      t.title,
      t.description || null,
      cap(t.category),
      cap(t.priority),
      TASK_STATUS_LABELS[t.status],
      t.due_date,
      (t.owner_user_id ? names.get(t.owner_user_id) : null) ?? t.owner_label ?? null,
      after.length ? after.join("; ") : null,
    ];
  });

  const budgetRows: Cell[][] = (overview?.budgetCategories ?? []).map((b) => [
    b.name,
    b.estimatedAmount,
    b.note || null,
  ]);

  const scheduleRows: Cell[][] = (overview?.schedule ?? []).map((s) => [
    s.date,
    s.start,
    s.end,
    s.title,
    s.note || null,
  ]);

  const vendorRows: Cell[][] = input.shortlist.map((v) => [
    SERVICE_LABELS[v.category],
    v.name,
    v.address,
    v.phone,
    v.website,
    `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`,
    v.note,
    "Candidate only: not contacted, no quote or booking",
  ]);

  return {
    fileName: exportFileName(event.name, input.exportedAt),
    currency: budgetCurrency,
    eventBudget: event.budget_amount,
    sheets: {
      overview: {
        name: "Event Overview",
        headers: [],
        rows: overviewRows,
        emptyNote: "",
        widths: [32, 70],
      },
      tasks: {
        name: "Task Tracker",
        headers: [
          "Task",
          "Description",
          "Category",
          "Priority",
          "Status",
          "Due date",
          "Owner",
          "Depends on",
        ],
        rows: taskRows,
        emptyNote: "No tasks yet. Accept a plan or add tasks to see them here.",
        widths: [38, 60, 16, 12, 14, 14, 22, 36],
      },
      budget: {
        name: "Budget",
        headers: ["Category", `Estimated allowance (${budgetCurrency})`, "Note"],
        rows: budgetRows,
        emptyNote: "No budget breakdown yet. Generate a plan to get one.",
        currencyColumns: [1],
        widths: [30, 26, 70],
      },
      schedule: {
        name: "Event Schedule",
        headers: ["Date", "Start", "End", "Session", "Note"],
        rows: scheduleRows,
        emptyNote: "No schedule yet. Generate a plan to get a draft timetable.",
        widths: [14, 10, 10, 40, 60],
      },
      vendors: {
        name: "Vendor Shortlist",
        headers: [
          "Service",
          "Vendor",
          "Address",
          "Phone",
          "Website",
          "Map",
          "Organizer note",
          "Status",
        ],
        rows: vendorRows,
        emptyNote: "No vendors shortlisted yet. Use Find vendors to add some.",
        widths: [16, 34, 50, 20, 34, 40, 36, 38],
      },
    },
  };
}
