import "server-only";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { RubricSchema } from "@/lib/activity-schema";
import type { GradesData } from "@/lib/grades-schema";
import { maxScore } from "@/lib/submissions-schema";
import { createClient } from "@/lib/supabase/server";

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Everything the Grades tab and its Excel export need for one section. Null if not visible (RLS). */
export async function getSectionGrades(sectionId: string): Promise<GradesData | null | { error: true }> {
  await requirePermission("sections");
  if (!z.uuid().safeParse(sectionId).success) return null;

  const supabase = await createClient();
  const { data: section, error: sErr } = await supabase
    .from("sections")
    .select("id, name, course:courses(id, name)")
    .eq("id", sectionId)
    .maybeSingle();
  if (sErr) return { error: true };
  const course = section ? one(section.course as Embedded<{ id: string; name: string }>) : null;
  if (!section || !course) return null;

  const [links, roster] = await Promise.all([
    supabase
      .from("activity_sections")
      .select("activity:activities(id, title, total_score, rubric, created_at)")
      .eq("section_id", sectionId),
    supabase.from("section_students").select("id, id_number, full_name").eq("section_id", sectionId).order("full_name"),
  ]);
  if (links.error || roster.error) return { error: true };

  type Raw = { id: string; title: string; total_score: number | string | null; rubric: unknown; created_at: string };
  const activities = (links.data ?? [])
    .map((l) => one(l.activity as Embedded<Raw>))
    .filter((a): a is Raw => a !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => {
      const rubric = a.rubric == null ? null : RubricSchema.safeParse(a.rubric);
      return {
        id: a.id,
        title: a.title,
        max: maxScore({
          rubric: rubric && rubric.success ? rubric.data : null,
          total_score: a.total_score == null ? null : Number(a.total_score),
        }),
      };
    });

  const scores: Record<string, number> = {};
  if (activities.length > 0 && (roster.data ?? []).length > 0) {
    const subs = await supabase
      .from("student_submissions")
      .select("student_id, activity_id, total_score")
      .in("activity_id", activities.map((a) => a.id))
      .not("checked_at", "is", null);
    if (subs.error) return { error: true };
    for (const s of subs.data ?? []) scores[`${s.student_id}:${s.activity_id}`] = Number(s.total_score);
  }

  return {
    courseId: course.id,
    courseName: course.name,
    sectionId: section.id,
    sectionName: section.name,
    activities,
    students: roster.data ?? [],
    scores,
  };
}
