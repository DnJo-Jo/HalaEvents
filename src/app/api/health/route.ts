import { connection } from "next/server";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  await connection(); // always evaluate at request time, never prerender
  const report = buildHealthReport();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
