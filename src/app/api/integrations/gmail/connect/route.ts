import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { authorizationUrl, GmailError } from "@/lib/integrations/gmail";

/** Starts the read-only Gmail consent flow. The state value is kept in a short-lived cookie. */
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("event") ?? "";
  if (!z.uuid().safeParse(eventId).success)
    return NextResponse.redirect(new URL("/app", request.url));
  const back = (flag: string) =>
    NextResponse.redirect(new URL(`/app/events/${eventId}?gmail=${flag}`, request.url));
  if (!(await getSessionUser())) return NextResponse.redirect(new URL("/sign-in", request.url));

  const state = randomBytes(24).toString("hex");
  let target: string;
  try {
    target = authorizationUrl(state);
  } catch (e) {
    if (e instanceof GmailError) return back("unavailable");
    throw e;
  }
  const res = NextResponse.redirect(target);
  res.cookies.set("gmail_oauth", `${state}.${eventId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/integrations/gmail",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
