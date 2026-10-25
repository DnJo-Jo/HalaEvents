import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { GmailError } from "@/lib/integrations/gmail";
import { completeConnection } from "@/modules/inbox/service";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google redirects here with ?code&state. The state must match the cookie set by /connect. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [cookieState, eventId] = (request.cookies.get("gmail_oauth")?.value ?? "").split(".");
  if (!cookieState || !z.uuid().safeParse(eventId).success)
    return NextResponse.redirect(new URL("/app", request.url));
  const finish = (flag: string) => {
    const res = NextResponse.redirect(new URL(`/app/events/${eventId}?gmail=${flag}`, request.url));
    res.cookies.delete({ name: "gmail_oauth", path: "/api/integrations/gmail" });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!same(state, cookieState) || params.get("error") || !code) return finish("failed");
  if (!(await getSessionUser())) return NextResponse.redirect(new URL("/sign-in", request.url));
  try {
    await completeConnection(eventId, code);
    return finish("connected");
  } catch (e) {
    if (e instanceof AppError || e instanceof GmailError) return finish("failed");
    throw e;
  }
}
