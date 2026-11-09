import "server-only";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { RubricSchema, type Rubric } from "@/lib/activity-schema";
import { createClient } from "@/lib/supabase/server";

export type ActivityRow = {
  id: string;
  title: string;
  description: string;
  file_url: string | null;
  total_score: number | null;
  rubric: Rubric | null;
  created_at: string;
};

/** An activity shown in a section's list: `section_count` is how many sections share it. */
export type ActivityListItem = ActivityRow & { section_count: number };

/** One accordion panel of the "reuse" modal: a section of the course and its activities. */
export type ReuseGroup = { sectionId: string; sectionName: string; activities: ActivityRow[] };

export type SectionDetail = {
  id: string;
  name: string;
  course: { id: string; name: string };
  activities: ActivityListItem[];
  reusable: ReuseGroup[];
  students: StudentRow[];
  canEditActivities: boolean;
};

export type StudentRow = { id: string; id_number: string; full_name: string };

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const COLUMNS = "id, title, problem, file_url, total_score, rubric, created_at";

type RawActivity = {
  id: string;
  title: string;
  problem: string;
  file_url: string | null;
  total_score: number | string | null;
  rubric: unknown;
  created_at: string;
};

function toActivity(r: RawActivity): ActivityRow {
  const rubric = r.rubric == null ? null : RubricSchema.safeParse(r.rubric);
  return {
    id: r.id,
    title: r.title,
    description: r.problem,
    file_url: r.file_url,
    total_score: r.total_score == null ? null : Number(r.total_score),
    rubric: rubric && rubric.success ? rubric.data : null,
    created_at: r.created_at,
  };
}

/** One section with its activities, or null if missing / not the caller's (RLS hides it). */
export async function getSection(courseId: string, sectionId: string): Promise<SectionDetail | null | { error: true }> {
  const state = await requirePermission("sections");
  if (!z.uuid().safeParse(courseId).success || !z.uuid().safeParse(sectionId).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("id, name, course:courses(id, name)")
    .eq("id", sectionId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) return { error: true };
  if (!data) return null;
  const course = one(data.course as Embedded<{ id: string; name: string }>);
  if (!course) return null;

  const canEditActivities = state.permissions.includes("activities");
  const activities: ActivityListItem[] = [];
  let reusable: ReuseGroup[] = [];
  if (canEditActivities) {
    const linked = await supabase
      .from("activity_sections")
      .select(`created_at, activity:activities(${COLUMNS}, links:activity_sections(count))`)
      .eq("section_id", sectionId)
      .order("created_at", { ascending: false });
    if (linked.error) return { error: true };
    for (const row of linked.data ?? []) {
      const a = one(row.activity as Embedded<RawActivity & { links: Embedded<{ count: number }> }>);
      if (!a) continue;
      activities.push({ ...toActivity(a), section_count: one(a.links)?.count ?? 1 });
    }

    // Everything in this course, grouped by section, minus what this section already has.
    const mine = new Set(activities.map((a) => a.id));
    const groups = await supabase
      .from("sections")
      .select(`id, name, links:activity_sections(activity:activities(${COLUMNS}))`)
      .eq("course_id", courseId)
      .order("created_at")
      .order("name");
    if (groups.error) return { error: true };
    reusable = (groups.data ?? [])
      .map((g) => ({
        sectionId: g.id as string,
        sectionName: g.name as string,
        activities: ((g.links ?? []) as { activity: Embedded<RawActivity> }[])
          .map((l) => one(l.activity))
          .filter((a): a is RawActivity => a !== null && !mine.has(a.id))
          .map(toActivity),
      }))
      .filter((g) => g.activities.length > 0);
  }
  const roster = await supabase
    .from("section_students")
    .select("id, id_number, full_name")
    .eq("section_id", sectionId)
    .order("full_name");
  if (roster.error) return { error: true };

  return { id: data.id, name: data.name, course, activities, reusable, students: roster.data ?? [], canEditActivities };
}

export type ActivityDetail = {
  activity: ActivityRow;
  section: { id: string; name: string };
  course: { id: string; name: string };
  /** Every section that currently uses this activity. */
  usedIn: { id: string; name: string }[];
};

/** One activity as used by one section, or null if missing / not the caller's. */
export async function getActivity(
  courseId: string,
  sectionId: string,
  activityId: string,
): Promise<ActivityDetail | null | { error: true }> {
  await requirePermission("activities");
  if (![courseId, sectionId, activityId].every((v) => z.uuid().safeParse(v).success)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_sections")
    .select(`activity:activities(${COLUMNS}), section:sections!inner(id, name, course:courses!inner(id, name))`)
    .eq("activity_id", activityId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (error) return { error: true };
  if (!data) return null;

  const activity = one(data.activity as Embedded<RawActivity>);
  const section = one(data.section as Embedded<{ id: string; name: string; course: Embedded<{ id: string; name: string }> }>);
  const course = section ? one(section.course) : null;
  if (!activity || !section || !course || course.id !== courseId) return null;

  const used = await supabase
    .from("activity_sections")
    .select("section:sections(id, name)")
    .eq("activity_id", activityId);
  if (used.error) return { error: true };
  const usedIn = (used.data ?? [])
    .map((r) => one(r.section as Embedded<{ id: string; name: string }>))
    .filter((s): s is { id: string; name: string } => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { activity: toActivity(activity), section: { id: section.id, name: section.name }, course, usedIn };
}
