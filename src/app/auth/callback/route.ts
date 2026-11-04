import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveState, destinationFor, fetchProfile } from "@/lib/auth/access";
import { safeNextPath } from "@/lib/auth/redirects";

// Email-confirmation link target. Exchanges the one-time code for a session.
// Verifying an email never changes approval status: the user lands wherever
// their (unchanged) state sends them, normally /pending-approval.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const failure = NextResponse.redirect(new URL("/verify-email?error=link", origin));

  if (!code) return failure;

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failure;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure;

  const profile = user.email_confirmed_at ? await fetchProfile(supabase, user.id) : null;
  const destination = destinationFor(deriveState(user, profile));

  // `next` is honoured only if it is on the internal allowlist AND the user's
  // own state already points there (so it can never widen access).
  const next = safeNextPath(searchParams.get("next"));
  return NextResponse.redirect(new URL(next === destination ? next : destination, origin));
}
