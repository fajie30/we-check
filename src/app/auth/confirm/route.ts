import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Target of admin-generated links (invite / password reset). The link carries a
// one-time token_hash that is verified here, server-side, then the user is sent
// to choose a password.
const ALLOWED_TYPES = new Set(["invite", "recovery"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const failure = NextResponse.redirect(new URL("/verify-email?error=link", origin));

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) return failure;

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "invite" | "recovery",
  });
  if (error) return failure;

  return NextResponse.redirect(new URL("/set-password", origin));
}
