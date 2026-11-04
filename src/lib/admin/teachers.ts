import "server-only";
import { requireAdmin } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type Teacher = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  role_label: string;
  approval_status: "pending_approval" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  email_verified: boolean;
  deactivated_at: string | null;
};

export type TeacherCounts = {
  pending: number;
  approved: number;
  rejected: number;
  deactivated: number;
  total: number;
};

export function countTeachers(teachers: Teacher[]): TeacherCounts {
  // Deactivated people are counted on their own, not under their approval status.
  const active = teachers.filter((t) => !t.deactivated_at);
  const pending = active.filter((t) => t.approval_status === "pending_approval").length;
  const approved = active.filter((t) => t.approval_status === "approved").length;
  const rejected = active.filter((t) => t.approval_status === "rejected").length;
  return { pending, approved, rejected, deactivated: teachers.length - active.length, total: teachers.length };
}

/**
 * Admin-only. Re-checks authorization on the server, then calls an RPC that
 * checks it again inside the database (is_admin()).
 */
export async function getTeachers(): Promise<{ teachers: Teacher[] } | { error: true }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error || !data) return { error: true };

  // Deactivation state is read straight from profiles (the admin can read all rows via RLS).
  const { data: flags, error: flagError } = await supabase.from("profiles").select("id, deactivated_at");
  if (flagError || !flags) return { error: true };
  const deactivated = new Map(flags.map((f) => [f.id, f.deactivated_at as string | null]));

  const rows = (data as Omit<Teacher, "deactivated_at">[]).map((u) => ({
    ...u,
    deactivated_at: deactivated.get(u.id) ?? null,
  }));
  return { teachers: rows };
}
