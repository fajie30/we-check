import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Service-role client. Bypasses RLS, so it is used ONLY for Supabase Auth admin
 * operations (inviting a user, changing an email, banning/unbanning a login) and
 * ONLY from server actions that have already run requireAdmin() +
 * requirePermission(). Every change to application data still goes through
 * admin-checked database functions with the admin's own session.
 *
 * Never import this from a Client Component or a page.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only, no NEXT_PUBLIC_ prefix
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
