import "server-only";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { getActivity, type ActivityRow } from "@/lib/activities";
import { SnapshotSchema, maxScore, type Snapshot } from "@/lib/submissions-schema";
import { createClient } from "@/lib/supabase/server";

export type StudentCheckRow = {
  id: string;
  id_number: string;
  full_name: string;
  link: string | null;
  checked: boolean;
  /** Real score once checked, otherwise 0 (the default shown to the teacher). */
  score: number;
  selections: Snapshot[] | null;
  remarks: string | null;
};

export type ActivityPageData = {
  activity: ActivityRow;
  section: { id: string; name: string };
  course: { id: string; name: string };
  usedIn: { id: string; name: string }[];
  max: number;
  students: StudentCheckRow[];
  checkedCount: number;
};

/** The activity as one section sees it: every student on the roster, with link and check state. */
export async function getActivityPage(
  courseId: string,
  sectionId: string,
  activityId: string,
): Promise<ActivityPageData | null | { error: true }> {
  await requirePermission("sections");
  const detail = await getActivity(courseId, sectionId, activityId);
  if (detail === null || "error" in detail) return detail;

  const supabase = await createClient();
  const [roster, subs] = await Promise.all([
    supabase.from("section_students").select("id, id_number, full_name").eq("section_id", sectionId).order("full_name"),
    supabase
      .from("student_submissions")
      .select("student_id, link_url, checked_at, total_score, selections, remarks")
      .eq("activity_id", activityId),
  ]);
  if (roster.error || subs.error) return { error: true };

  const byStudent = new Map((subs.data ?? []).map((s) => [s.student_id as string, s]));
  const students: StudentCheckRow[] = (roster.data ?? []).map((st) => {
    const s = byStudent.get(st.id);
    const sel = s?.selections == null ? null : z.array(SnapshotSchema).safeParse(s.selections);
    return {
      id: st.id,
      id_number: st.id_number,
      full_name: st.full_name,
      link: s?.link_url ?? null,
      checked: s?.checked_at != null,
      score: s?.total_score == null ? 0 : Number(s.total_score),
      selections: sel && sel.success ? sel.data : null,
      remarks: s?.remarks ?? null,
    };
  });

  return {
    ...detail,
    max: maxScore(detail.activity),
    students,
    checkedCount: students.filter((s) => s.checked).length,
  };
}
