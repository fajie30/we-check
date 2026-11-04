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
};

export type TeacherCounts = { pending: number; approved: number; rejected: number; total: number };

export function countTeachers(teachers: Teacher[]): TeacherCounts {
  const pending = teachers.filter((t) => t.approval_status === "pending_approval").length;
  const approved = teachers.filter((t) => t.approval_status === "approved").length;
  const rejected = teachers.filter((t) => t.approval_status === "rejected").length;
  return { pending, approved, rejected, total: teachers.length };
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
  return { teachers: data as Teacher[] };
}
