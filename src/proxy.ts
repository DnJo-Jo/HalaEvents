import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath } from "@/modules/auth/rules";

/**
 * Runs before routes render (Next.js 16 "proxy", formerly middleware):
 *  1. refreshes the Supabase session cookie so Server Components see a valid token;
 *  2. redirects visitors without a session away from protected paths.
 *
 * This is a convenience, NOT the authorization layer: every protected page and action calls
 * requireUser()/requireMember() itself, and RLS applies to every query (event.md §2.5, §5).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  let response = NextResponse.next({ request });

  const toSignIn = () => {
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    target.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(target);
    // Keep any refreshed/cleared auth cookies and their no-store headers on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  };

  if (!url || !key) return isProtectedPath(pathname) ? toSignIn() : response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  // Do not put code between client creation and getClaims(): it refreshes the session if needed.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && isProtectedPath(pathname)) return toSignIn();
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation and the health endpoint.
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
