import "server-only";
import { requirePermission } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type PermissionRow = {
  key: string;
  label: string;
  description: string;
  roles: string[] | null; // null = any role
  excluded_roles: string[];
  admin_only: boolean;
  placeholder: boolean;
  sort_order: number;
};

export type RoleRow = {
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  users: number;
};

export type Matrix = { roles: RoleRow[]; permissions: PermissionRow[]; grants: string[] }; // grants: "role:key"

/** Admin-only (role_management). RLS also limits the matrix tables to the admin. */
export async function getMatrix(): Promise<Matrix | { error: true }> {
  await requirePermission("role_management");
  const supabase = await createClient();
  const [roles, perms, grants, holders] = await Promise.all([
    supabase.from("roles").select("key, label, description, is_system, created_at").order("created_at"),
    supabase.from("permissions").select("*").order("sort_order"),
    supabase.from("role_permissions").select("role, permission_key"),
    supabase.from("profiles").select("role"),
  ]);
  if (
    roles.error || perms.error || grants.error || holders.error ||
    !roles.data || !perms.data || !grants.data || !holders.data
  ) {
    return { error: true };
  }

  const counts = new Map<string, number>();
  for (const h of holders.data) counts.set(h.role, (counts.get(h.role) ?? 0) + 1);

  // Admin first, then Teacher, then custom roles in creation order.
  const rank = (k: string) => (k === "admin" ? 0 : k === "instructor" ? 1 : 2);
  const rows: RoleRow[] = roles.data
    .map((r) => ({
      key: r.key,
      label: r.label,
      description: r.description,
      is_system: r.is_system,
      users: counts.get(r.key) ?? 0,
    }))
    .sort((a, b) => rank(a.key) - rank(b.key));

  return {
    roles: rows,
    permissions: perms.data as PermissionRow[],
    grants: grants.data.map((g) => `${g.role}:${g.permission_key}`),
  };
}

/** Roles a user can be assigned (everything except admin). */
export async function getAssignableRoles(): Promise<{ key: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("key, label, created_at").neq("key", "admin").order("created_at");
  return (data ?? []).map((r) => ({ key: r.key, label: r.label }));
}
