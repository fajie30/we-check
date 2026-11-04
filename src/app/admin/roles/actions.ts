"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requirePermission } from "@/lib/auth/access";
import { PERMISSION_KEYS, ROLES } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  role: z.enum(ROLES),
  key: z.enum(PERMISSION_KEYS),
  granted: z.boolean(),
});

export type RoleResult = { ok: true } | { ok: false; message: string };

export async function setRolePermission(input: unknown): Promise<RoleResult> {
  await requireAdmin();
  await requirePermission("role_management");

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't allowed." };

  // The database function re-verifies the admin and rejects locked/invalid cells.
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role_permission", {
    p_role: parsed.data.role,
    p_key: parsed.data.key,
    p_granted: parsed.data.granted,
  });
  if (error) return { ok: false, message: "That change couldn't be saved. Refresh and try again." };

  revalidatePath("/admin/roles");
  return { ok: true };
}
