import "server-only";
import ExcelJS from "exceljs";
import type { ExportModel, Sheet } from "./model";

const HEADER_FILL = "FF1F3A5F";
const MONEY = "#,##0.00";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 22;
}

function addTable(ws: ExcelJS.Worksheet, sheet: Sheet) {
  ws.columns = sheet.widths.map((width) => ({ width }));
  const header = ws.addRow(sheet.headers);
  styleHeader(header);
  for (const r of sheet.rows) ws.addRow(r);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rows.length + 1, column: sheet.headers.length },
    };
  } else {
    const note = ws.addRow([sheet.emptyNote]);
    note.font = { italic: true, color: { argb: "FF667085" } };
  }
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
  for (const c of sheet.currencyColumns ?? []) ws.getColumn(c + 1).numFmt = MONEY;
}

/** Writes the model to an .xlsx buffer. Totals are formulas so they follow later edits. */
export async function buildWorkbook(model: ExportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HalaEvents";
  wb.created = new Date();
  const { overview, tasks, budget, schedule, vendors } = model.sheets;

  // 1. Event Overview: label / value pairs.
  const ov = wb.addWorksheet(overview.name);
  ov.columns = overview.widths.map((width) => ({ width }));
  styleHeader(ov.addRow(["Field", "Value"]));
  for (const [label, value] of overview.rows) {
    const row = ov.addRow([label, value ?? "Not provided"]);
    row.getCell(1).font = { bold: true };
    if (value === null) row.getCell(2).font = { italic: true, color: { argb: "FF667085" } };
    row.alignment = { vertical: "top", wrapText: true };
  }
  ov.getColumn(2).alignment = { horizontal: "left", wrapText: true };

  addTable(wb.addWorksheet(tasks.name), tasks);

  // 3. Budget: table + totals comparing the illustrative allowances with the event budget.
  const bu = wb.addWorksheet(budget.name);
  addTable(bu, budget);
  const last = budget.rows.length + 1;
  const totalRow = last + 1;
  const budgetRow = last + 3;
  const bold = (row: ExcelJS.Row) => (row.font = { bold: true });
  if (budget.rows.length > 0) {
    const total = bu.addRow(["Total estimated", { formula: `SUM(B2:B${last})` }, null]);
    bold(total);
    total.getCell(2).numFmt = MONEY;
    bu.addRow([]);
    const eb = bu.addRow([
      "Event budget",
      model.eventBudget,
      model.eventBudget === null ? "No event budget set" : null,
    ]);
    eb.getCell(2).numFmt = MONEY;
    if (model.eventBudget !== null) {
      const diff = bu.addRow([
        "Budget minus estimate",
        { formula: `B${budgetRow}-B${totalRow}` },
        null,
      ]);
      diff.getCell(2).numFmt = MONEY;
      bold(diff);
    }
    bu.addRow([]);
    const disclaimer = bu.addRow([
      "Amounts are illustrative allowances from the plan, not quotes or prices.",
    ]);
    disclaimer.font = { italic: true, color: { argb: "FF667085" } };
  }

  addTable(wb.addWorksheet(schedule.name), schedule);
  addTable(wb.addWorksheet(vendors.name), vendors);
  for (const row of wb.getWorksheet(vendors.name)?.getRows(2, vendors.rows.length) ?? []) {
    const site = row.getCell(5);
    if (typeof site.value === "string" && /^https?:\/\//.test(site.value))
      site.value = { text: site.value, hyperlink: site.value };
    const map = row.getCell(6);
    if (typeof map.value === "string") map.value = { text: "Open map", hyperlink: map.value };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
