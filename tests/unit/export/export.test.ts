// @vitest-environment node
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Export mapping + workbook (read back with ExcelJS) + authorization with an in-memory Supabase
// double. No AI, vendor or Google call is involved: nothing here touches the network.

let state: FakeState;
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  }),
}));

const { buildExportModel, exportFileName } = await import("@/modules/export/model");
const { exportEventWorkbook, exportAvailability } = await import("@/modules/export/service");
const { GET } = await import("@/app/api/events/[eventId]/export/route");

const EVENT = "11111111-1111-4111-8111-111111111111";
const event = {
  id: EVENT,
  owner_id: "owner",
  name: "Campus Hack 2026!",
  event_type: "university_hackathon",
  status: "planning",
  venue_type: "indoor",
  location_text: "Main hall",
  city: "Dubai",
  country: "AE",
  timezone: "Asia/Dubai",
  starts_at: "2026-12-01T05:00:00Z",
  ends_at: "2026-12-02T14:00:00Z",
  capacity: 120,
  budget_amount: 50000,
  currency: "AED",
  services: ["venue", "catering"],
};
const overview = {
  summary: "A two-day hackathon for students.",
  goals: [],
  requirements: [],
  missingInformation: [],
  decisions: [],
  followUpQuestions: [],
  budgetCategories: [
    { name: "Venue", estimatedAmount: 20000, note: "Illustrative" },
    { name: "Catering", estimatedAmount: 12500.5, note: "" },
  ],
  budgetSummary: "",
  risks: [],
  conflicts: [],
  schedule: [{ date: "2026-12-01", start: "09:00", end: "10:00", title: "Opening", note: "" }],
};
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  event_id: EVENT,
  title: `Task ${id}`,
  description: "",
  category: "venue",
  priority: "high",
  status: "todo",
  due_date: "2026-11-20",
  owner_user_id: null,
  owner_label: null,
  origin: "ai_plan",
  completed_at: null,
  updated_at: "2026-10-24T00:00:00Z",
  ...extra,
});

function setup(role: "owner" | "organizer" | "viewer" | null, full = true) {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [event];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  state.tables.tasks = full ? [task("a"), task("b", { owner_user_id: "user-1" })] : [];
  state.tables.task_dependencies = full
    ? [{ event_id: EVENT, task_id: "b", depends_on_task_id: "a" }]
    : [];
  state.tables.ai_plans = full
    ? [
        {
          id: "plan-1",
          event_id: EVENT,
          status: "current",
          source: "ai",
          input_hash: "h",
          assumptions: [],
          overview,
          is_mock: false,
          created_at: "2026-10-24T00:00:00Z",
          ai_run_id: null,
        },
      ]
    : [];
  state.tables.ai_suggestions = [];
  state.tables.event_vendor_shortlist = full
    ? [
        {
          event_id: EVENT,
          category: "catering",
          place_id: "p1",
          name: "Cafe One",
          address: "Dubai",
          phone: null,
          website: "https://cafe.example",
          latitude: 25.2,
          longitude: 55.3,
          note: "ask about halal",
          created_at: "2026-10-24T00:00:00Z",
        },
      ]
    : [];
  state.rpc.event_member_directory = {
    data: [{ user_id: "user-1", display_name: "Sara", role: "organizer" }],
  };
}

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

describe("exportEventWorkbook", () => {
  it("writes the five worksheets from persisted data", async () => {
    setup("organizer");
    const { fileName, data } = await exportEventWorkbook(EVENT, new Date("2026-10-24T10:00:00Z"));
    expect(fileName).toBe("halaevents-campus-hack-2026-2026-10-24.xlsx");
    const wb = await read(data);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Event Overview",
      "Task Tracker",
      "Budget",
      "Event Schedule",
      "Vendor Shortlist",
    ]);

    const ov = wb.getWorksheet("Event Overview")!;
    const fields = new Map(
      ov.getRows(2, ov.rowCount)!.map((r) => [r.getCell(1).value, r.getCell(2).value]),
    );
    expect(fields.get("Event name")).toBe("Campus Hack 2026!");
    expect(fields.get("Expected attendance (capacity)")).toBe(120);
    expect(fields.get("Event budget")).toBe("50000 AED");
    expect(fields.get("Services needed")).toBe("Venue, Catering");
    expect(String(fields.get("Starts"))).toContain("09:00"); // shown in the event's own time zone

    const tasks = wb.getWorksheet("Task Tracker")!;
    expect(tasks.rowCount).toBe(3);
    expect(tasks.getRow(3).getCell(7).value).toBe("Sara");
    expect(tasks.getRow(3).getCell(8).value).toBe("Task a");
    expect(tasks.autoFilter).toBeTruthy();

    const budget = wb.getWorksheet("Budget")!;
    expect(budget.getRow(2).getCell(2).value).toBe(20000);
    expect(budget.getRow(2).getCell(2).numFmt).toBe("#,##0.00");
    expect(budget.getRow(4).getCell(2).value).toMatchObject({ formula: "SUM(B2:B3)" });

    const schedule = wb.getWorksheet("Event Schedule")!;
    expect(schedule.getRow(2).values).toEqual(
      expect.arrayContaining(["2026-12-01", "09:00", "Opening"]),
    );

    const vendors = wb.getWorksheet("Vendor Shortlist")!;
    expect(vendors.getRow(2).getCell(2).value).toBe("Cafe One");
    expect(vendors.getRow(2).getCell(4).value).toBeNull(); // no phone returned: left empty
    expect(vendors.getRow(2).getCell(7).value).toBe("ask about halal");
    expect(String(vendors.getRow(2).getCell(8).value)).toMatch(/not contacted/);
    expect(headerFill(tasks)).toBe("FF1F3A5F");
  });

  it("an event with no plan, tasks or vendors still exports, with empty-state notes", async () => {
    setup("owner", false);
    const wb = await read((await exportEventWorkbook(EVENT)).data);
    expect(wb.worksheets).toHaveLength(5);
    expect(String(wb.getWorksheet("Task Tracker")!.getRow(2).getCell(1).value)).toMatch(
      /No tasks yet/,
    );
    expect(String(wb.getWorksheet("Budget")!.getRow(2).getCell(1).value)).toMatch(/No budget/);
    expect(String(wb.getWorksheet("Event Schedule")!.getRow(2).getCell(1).value)).toMatch(
      /No schedule/,
    );
    expect(String(wb.getWorksheet("Vendor Shortlist")!.getRow(2).getCell(1).value)).toMatch(
      /No vendors/,
    );
  });

  it("only owners and organizers can export; outsiders get a 404", async () => {
    setup("viewer");
    await expect(exportEventWorkbook(EVENT)).rejects.toMatchObject({ code: "forbidden" });
    setup(null);
    await expect(exportEventWorkbook(EVENT)).rejects.toMatchObject({ notFound: true });
  });
});

describe("download route", () => {
  const call = (id = EVENT) =>
    GET(new Request("http://x"), { params: Promise.resolve({ eventId: id }) });

  it("returns the xlsx as an attachment for an organizer", async () => {
    setup("organizer");
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="halaevents-/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await read(Buffer.from(await res.arrayBuffer()))).worksheets).toHaveLength(5);
  });

  it("viewers get 403 JSON, bad ids 404, and no file is produced", async () => {
    setup("viewer");
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toContain("json");
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await call("nope")).status).toBe(404);
  });
});

describe("availability and mapping helpers", () => {
  it("the dashboard offers the export only when there is a plan or tasks", async () => {
    setup("owner", true);
    expect(await exportAvailability(EVENT)).toBe(true);
    setup("owner", false);
    expect(await exportAvailability(EVENT)).toBe(false);
  });

  it("file names are safe and plan amounts keep the event currency", () => {
    expect(exportFileName('../../etc/"passwd"\n', new Date("2026-01-02T00:00:00Z"))).toBe(
      "halaevents-etcpasswd-2026-01-02.xlsx",
    );
    expect(exportFileName("???", new Date("2026-01-02T00:00:00Z"))).toBe(
      "halaevents-event-2026-01-02.xlsx",
    );
    const m = buildExportModel({
      event: { ...event, currency: "USD" } as never,
      tasks: [],
      dependencies: [],
      members: [],
      overview: null,
      planSource: null,
      shortlist: [],
      exportedAt: new Date(),
    });
    expect(m.sheets.budget.headers[1]).toContain("USD");
    expect(m.sheets.budget.rows).toEqual([]);
  });
});

function headerFill(ws: ExcelJS.Worksheet) {
  const fill = ws.getRow(1).getCell(1).fill as ExcelJS.FillPattern;
  return fill.fgColor?.argb;
}
