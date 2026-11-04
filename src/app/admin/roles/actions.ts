"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requirePermission } from "@/lib/auth/access";
import { PERMISSION_KEYS, ROLE_KEY_PATTERN, slugifyRoleKey } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type RoleResult = { ok: true } | { ok: false; message: string };

const roleKey = z.string().regex(ROLE_KEY_PATTERN);
const label = z.string().trim().min(2, "Name must be at least 2 characters").max(40, "Name must be 40 characters or fewer");
const description = z.string().trim().max(200, "Description must be 200 characters or fewer").optional();

const FAILED: RoleResult = { ok: false, message: "That change couldn't be saved. Refresh and try again." };

async function guard() {
  await requireAdmin();
  await requirePermission("role_management");
  return createClient();
}

function firstIssue(e: z.ZodError): RoleResult {
  return { ok: false, message: e.issues[0]?.message ?? "That change isn't allowed." };
}

// --- Matrix cell ------------------------------------------------------------
const cellSchema = z.object({ role: roleKey, key: z.enum(PERMISSION_KEYS), granted: z.boolean() });

export async function setRolePermission(input: unknown): Promise<RoleResult> {
  const supabase = await guard();
  const parsed = cellSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't allowed." };

  // The database re-verifies the admin and rejects locked / not-applicable cells.
  const { error } = await supabase.rpc("admin_set_role_permission", {
    p_role: parsed.data.role,
    p_key: parsed.data.key,
    p_granted: parsed.data.granted,
  });
  if (error) return FAILED;
  revalidatePath("/admin/roles");
  return { ok: true };
}

// --- Role CRUD --------------------------------------------------------------
const createSchema = z.object({ label, description, copyFrom: roleKey.optional() });

export async function createRole(input: unknown): Promise<RoleResult> {
  const supabase = await guard();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const key = slugifyRoleKey(parsed.data.label);
  if (!ROLE_KEY_PATTERN.test(key)) return { ok: false, message: "Use letters or numbers in the role name." };

  const { error } = await supabase.rpc("admin_create_role", {
    p_key: key,
    p_label: parsed.data.label,
    p_description: parsed.data.description || null,
    p_copy_from: parsed.data.copyFrom ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "A role with that name already exists." };
    return FAILED;
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
}

const updateSchema = z.object({ key: roleKey, label, description });

export async function updateRole(input: unknown): Promise<RoleResult> {
  const supabase = await guard();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const { error } = await supabase.rpc("admin_update_role", {
    p_key: parsed.data.key,
    p_label: parsed.data.label,
    p_description: parsed.data.description || null,
  });
  if (error) return FAILED;
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function deleteRole(input: unknown): Promise<RoleResult> {
  const supabase = await guard();
  const parsed = z.object({ key: roleKey }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't allowed." };

  const { error } = await supabase.rpc("admin_delete_role", { p_key: parsed.data.key });
  if (error) {
    if (error.code === "23503") {
      return { ok: false, message: "People still have this role. Reassign them first." };
    }
    return FAILED;
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
}

// --- Assign a role to a user ------------------------------------------------
const assignSchema = z.object({ userId: z.uuid(), role: roleKey });

export async function setUserRole(input: unknown): Promise<RoleResult> {
  const supabase = await guard();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't allowed." };

  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) return FAILED;
  revalidatePath("/admin", "layout");
  return { ok: true };
}
