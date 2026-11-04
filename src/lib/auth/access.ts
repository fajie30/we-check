import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./permissions";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "instructor";
  approval_status: "pending_approval" | "approved" | "rejected";
  rejection_reason: string | null;
};

/**
 * The single answer to "what is this visitor allowed to see?".
 * Derived server-side from getUser() (server-verified) plus the profile read
 * under RLS. Client-sent role/status is never trusted.
 */
export type AccessState =
  | { kind: "anon" }
  | { kind: "no_profile" }
  | { kind: "unverified"; email: string }
  | { kind: "pending"; profile: Profile }
  | { kind: "rejected"; profile: Profile }
  | { kind: "instructor"; profile: Profile; permissions: string[] } // approved + verified
  | { kind: "admin"; profile: Profile; permissions: string[] };

type Kind = AccessState["kind"];

/** Pure decision table. Email verification comes only from email_confirmed_at. */
export function deriveState(
  user: { email?: string | null; email_confirmed_at?: string | null } | null,
  profile: Profile | null,
  permissions: string[] = [],
): AccessState {
  if (!user) return { kind: "anon" };
  if (!user.email_confirmed_at) return { kind: "unverified", email: user.email ?? "" };
  if (!profile) return { kind: "no_profile" };
  if (profile.role === "admin") return { kind: "admin", profile, permissions };
  if (profile.approval_status === "approved") return { kind: "instructor", profile, permissions };
  if (profile.approval_status === "rejected") return { kind: "rejected", profile };
  return { kind: "pending", profile };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function fetchProfile(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, approval_status, rejection_reason")
    .eq("id", userId)
    .single<Profile>();
  return data ?? null;
}

export const getAccessState = cache(async (): Promise<AccessState> => {
  // Session checks depend on the current time (token expiry), so they must never
  // run while prerendering. connection() defers this to request time.
  await connection();
  const supabase = await createClient();

  // getUser() asks the Auth server to verify the token. Never use getSession() here.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { kind: "anon" };

  const profile = user.email_confirmed_at ? await fetchProfile(supabase, user.id) : null;

  // Effective permissions come from the database (my_permissions); pending and
  // rejected instructors get none.
  let permissions: string[] = [];
  if (profile && (profile.role === "admin" || profile.approval_status === "approved")) {
    const { data } = await supabase.rpc("my_permissions");
    permissions = Array.isArray(data) ? (data as string[]) : [];
  }
  return deriveState(user, profile, permissions);
});

export function destinationFor(state: AccessState): string {
  switch (state.kind) {
    case "anon":
    case "no_profile":
      return "/login";
    case "unverified":
      return "/verify-email";
    case "pending":
      return "/pending-approval";
    case "rejected":
      return "/rejected";
    case "instructor":
      return "/instructor";
    case "admin":
      return "/admin";
  }
}

/**
 * Page/action guard: returns the state if it is one of `allowed`, otherwise
 * redirects to where that state belongs. Call from every protected page,
 * server action and route handler (defense in depth beyond proxy.ts).
 */
async function requireKind<K extends Kind>(...allowed: K[]) {
  const state = await getAccessState();
  if (!(allowed as Kind[]).includes(state.kind)) redirect(destinationFor(state));
  return state as Extract<AccessState, { kind: K }>;
}

/**
 * Requires a signed-in admin/approved instructor whose role holds `key`.
 * Instructors without it go to /no-access; admins fall back to /admin.
 */
export async function requirePermission(key: PermissionKey) {
  const state = await getAccessState();
  if (state.kind !== "admin" && state.kind !== "instructor") redirect(destinationFor(state));
  if (!state.permissions.includes(key)) {
    if (state.kind === "admin") redirect("/admin");
    // Teachers: /instructor itself falls through to /no-access when the
    // dashboard is off, so going there never loops.
    redirect(key === "instructor_dashboard" ? "/no-access" : "/instructor");
  }
  return state;
}

export const requireAdmin = () => requireKind("admin");
export const requireApprovedInstructor = () => requireKind("instructor");
export const requirePending = () => requireKind("pending");
export const requireRejected = () => requireKind("rejected");
export const requireUnverified = () => requireKind("unverified");

/** For /login and /register: signed-in users are sent to their destination. */
export async function redirectIfSignedIn() {
  const state = await getAccessState();
  if (state.kind !== "anon") redirect(destinationFor(state));
}
