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
  role: string; // roles.key ("admin", "instructor", or a custom role)
  role_label: string;
  approval_status: "pending_approval" | "approved" | "rejected";
  rejection_reason: string | null;
  deactivated_at: string | null;
};

/**
 * The single answer to "what is this visitor allowed to see?".
 * Derived server-side from getUser() (server-verified) plus the profile read
 * under RLS. Client-sent role/status is never trusted.
 *
 * "member" = an approved, verified user whose role is not admin (Teacher, Head,
 * any custom role). What a member can open is decided by `permissions`.
 */
export type AccessState =
  | { kind: "anon" }
  | { kind: "no_profile" }
  | { kind: "unverified"; email: string }
  | { kind: "pending"; profile: Profile }
  | { kind: "rejected"; profile: Profile }
  | { kind: "deactivated"; profile: Profile }
  | { kind: "member"; profile: Profile; permissions: string[] }
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
  if (profile.deactivated_at) return { kind: "deactivated", profile };
  if (profile.approval_status === "approved") return { kind: "member", profile, permissions };
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
    .select("id, full_name, email, role, approval_status, rejection_reason, deactivated_at, roles(label)")
    .eq("id", userId)
    .single();
  if (!data) return null;

  const embedded = data.roles as { label: string } | { label: string }[] | null;
  const label = Array.isArray(embedded) ? embedded[0]?.label : embedded?.label;
  return {
    id: data.id,
    full_name: data.full_name,
    email: data.email,
    role: data.role,
    role_label: label ?? data.role,
    approval_status: data.approval_status,
    rejection_reason: data.rejection_reason,
    deactivated_at: data.deactivated_at,
  };
}

/** Profile + effective permissions for an already-verified auth user. */
export async function resolveState(
  supabase: SupabaseServerClient,
  user: { id: string; email?: string | null; email_confirmed_at?: string | null },
): Promise<AccessState> {
  if (!user.email_confirmed_at) return deriveState(user, null);

  const profile = await fetchProfile(supabase, user.id);

  // Effective permissions come from the database (my_permissions); pending and
  // rejected users get none.
  let permissions: string[] = [];
  if (
    profile &&
    !profile.deactivated_at &&
    (profile.role === "admin" || profile.approval_status === "approved")
  ) {
    const { data } = await supabase.rpc("my_permissions");
    permissions = Array.isArray(data) ? (data as string[]) : [];
  }
  return deriveState(user, profile, permissions);
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

  return resolveState(supabase, user);
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
    case "deactivated":
      return "/deactivated";
    case "member":
      return state.permissions.includes("instructor_dashboard") ? "/instructor" : "/home";
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
 * Requires a signed-in admin/approved member whose role holds `key`.
 * Members without it go home; admins fall back to /admin.
 */
export async function requirePermission(key: PermissionKey) {
  const state = await getAccessState();
  if (state.kind !== "admin" && state.kind !== "member") redirect(destinationFor(state));
  if (!state.permissions.includes(key)) {
    // Send them to their own landing page. A member's landing page is /instructor
    // only if they hold instructor_dashboard, otherwise /home, which never
    // requires a permission, so this cannot loop.
    redirect(destinationFor(state));
  }
  return state;
}

export const requireAdmin = () => requireKind("admin");
export const requireMember = () => requireKind("member");
export const requirePending = () => requireKind("pending");
export const requireRejected = () => requireKind("rejected");
export const requireDeactivated = () => requireKind("deactivated");
export const requireUnverified = () => requireKind("unverified");

/** For /login and /register: signed-in users are sent to their destination. */
export async function redirectIfSignedIn() {
  const state = await getAccessState();
  // "no_profile" maps to /login, so redirecting it from /login would loop forever
  // (for example if the database is unreachable or out of date). Show the form instead.
  if (state.kind !== "anon" && state.kind !== "no_profile") redirect(destinationFor(state));
}
