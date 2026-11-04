import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Optimistic gate only: fast redirect for signed-out visitors. It is NOT the
// authorization layer. Every page and server action re-checks via
// src/lib/auth/access.ts.
// /verify-email is public on purpose: unverified users cannot sign in, so they
// have no session when they land there.
const PROTECTED_PREFIXES = ["/admin", "/instructor", "/pending-approval", "/rejected", "/home"];

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && isProtected) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    // Keep any cookies the session refresh set (e.g. cleared tokens).
    response().cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response();
}

export const config = {
  matcher: [
    // Skip Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
