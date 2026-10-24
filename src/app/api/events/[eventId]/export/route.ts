import { connection } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { exportEventWorkbook } from "@/modules/export/service";

const STATUS = { forbidden: 403, not_found: 404 } as const;

/** Downloads the event workbook. Thin: validate the id → service (authorizes) → file or error. */
export async function GET(_req: Request, ctx: { params: Promise<{ eventId: string }> }) {
  await connection(); // request time only
  const { eventId } = await ctx.params;
  if (!z.uuid().safeParse(eventId).success)
    return Response.json(
      { error: { code: "not_found", message: "Unknown event." } },
      { status: 404 },
    );
  try {
    const { fileName, data } = await exportEventWorkbook(eventId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError)
      return Response.json(
        { error: { code: e.code, message: e.message } },
        {
          status: STATUS[e.code as keyof typeof STATUS] ?? 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    throw e;
  }
}
