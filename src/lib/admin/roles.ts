import "server-only";
import { requirePermission } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type PermissionRow = {
  key: string;
  label: string;
  description: string;
  roles: ("admin" | "instructor")[];
  admin_only: boolean;
  placeholder: boolean;
  sort_order: number;
};

export type Matrix = { permissions: PermissionRow[]; grants: string[] }; // grants: "role:key"

/** Admin-only (role_management). RLS also limits these tables to the admin. */
export async function getMatrix(): Promise<Matrix | { error: true }> {
  await requirePermission("role_management");
  const supabase = await createClient();
  const [perms, grants] = await Promise.all([
    supabase.from("permissions").select("*").order("sort_order"),
    supabase.from("role_permissions").select("role, permission_key"),
  ]);
  if (perms.error || grants.error || !perms.data || !grants.data) return { error: true };
  return {
    permissions: perms.data as PermissionRow[],
    grants: grants.data.map((g) => `${g.role}:${g.permission_key}`),
  };
}
