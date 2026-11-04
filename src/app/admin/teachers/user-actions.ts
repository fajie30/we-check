"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin, requirePermission } from "@/lib/auth/access";
import { ROLE_KEY_PATTERN } from "@/lib/auth/permissions";
import { emailSchema, fullNameSchema } from "@/lib/auth/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type UserResult = { ok: true; link?: string; email?: string } | { ok: false; message: string };

const FAILED: UserResult = { ok: false, message: "That request couldn't be completed. Refresh and try again." };
const roleKey = z.string().regex(ROLE_KEY_PATTERN);

/** Every action: valid session + admin + teacher_approvals, verified on the server. */
async function guard() {
  await requireAdmin();
  await requirePermission("teacher_approvals");
  return createClient();
}

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const firstIssue = (e: z.ZodError): UserResult => ({
  ok: false,
  message: e.issues[0]?.message ?? "That request isn't valid.",
});

// --- Add a user (invite) ----------------------------------------------------
const createSchema = z.object({ fullName: fullNameSchema, email: emailSchema, role: roleKey });

export async function createUser(input: unknown): Promise<UserResult> {
  const supabase = await guard();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { fullName, email, role } = parsed.data;

  // Supabase silently RE-invites an address that was invited but never accepted, and our
  // rollback below deletes the Auth user. So refuse existing accounts up front: only an
  // account created by this very call can ever be rolled back.
  const { data: existing } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, message: "A user with that email already exists." };

  const auth = createAdminClient();
  const { data, error } = await auth.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName } },
  });
  if (error || !data?.user) {
    if (error?.code === "email_exists") return { ok: false, message: "A user with that email already exists." };
    return FAILED;
  }

  // Role + approval go through the admin-checked database function. If it
  // refuses, undo the Auth user so nothing half-created is left behind.
  const { error: prepError } = await supabase.rpc("admin_prepare_user", {
    p_user: data.user.id,
    p_role: role,
  });
  if (prepError) {
    await auth.auth.admin.deleteUser(data.user.id);
    return FAILED;
  }

  revalidatePath("/admin", "layout");
  const link = `${await siteOrigin()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
  return { ok: true, link, email };
}

// --- Edit a user ------------------------------------------------------------
const updateSchema = z.object({ id: z.uuid(), fullName: fullNameSchema, email: emailSchema });

export async function updateUser(input: unknown): Promise<UserResult> {
  const supabase = await guard();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { id, fullName, email } = parsed.data;

  const { data: current } = await supabase.from("profiles").select("email, role").eq("id", id).single();
  if (!current || current.role === "admin") return FAILED;

  if (current.email !== email) {
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", id)
      .maybeSingle();
    if (taken) return { ok: false, message: "A user with that email already exists." };

    // Email lives in Supabase Auth. A trigger mirrors it into profiles.email.
    const auth = createAdminClient();
    const { error } = await auth.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (error) {
      if (error.code === "email_exists") return { ok: false, message: "A user with that email already exists." };
      return FAILED;
    }
    await supabase.rpc("admin_log_user_event", { p_user: id, p_action: "edit", p_detail: { email_changed: true } });
  }

  const { error } = await supabase.rpc("admin_update_user", { p_user: id, p_full_name: fullName });
  if (error) return FAILED;

  revalidatePath("/admin", "layout");
  return { ok: true };
}

// --- Deactivate / reactivate ------------------------------------------------
const activeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export async function setUserActive(input: unknown): Promise<UserResult> {
  const supabase = await guard();
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return FAILED;
  const { id, active } = parsed.data;

  // 1. Database first: the admin check lives there, and the app stops serving
  //    the person on their very next request.
  const { error } = await supabase.rpc("admin_set_user_active", { p_user: id, p_active: active });
  if (error) return FAILED;

  // 2. Then block / unblock sign-in at the Auth level.
  const auth = createAdminClient();
  const { error: banError } = await auth.auth.admin.updateUserById(id, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) {
    await supabase.rpc("admin_set_user_active", { p_user: id, p_active: !active }); // roll back
    return FAILED;
  }

  revalidatePath("/admin", "layout");
  return { ok: true };
}

// --- One-time password link for an existing user ----------------------------
export async function createResetLink(input: unknown): Promise<UserResult> {
  const supabase = await guard();
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const { data: target } = await supabase
    .from("profiles")
    .select("email, role, deactivated_at")
    .eq("id", parsed.data.id)
    .single();
  if (!target || target.role === "admin" || target.deactivated_at) return FAILED;

  const auth = createAdminClient();
  const { data, error } = await auth.auth.admin.generateLink({ type: "recovery", email: target.email });
  if (error || !data) return FAILED;

  await supabase.rpc("admin_log_user_event", { p_user: parsed.data.id, p_action: "reset_link", p_detail: {} });
  const link = `${await siteOrigin()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
  return { ok: true, link, email: target.email };
}
