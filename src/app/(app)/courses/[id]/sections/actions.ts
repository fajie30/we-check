"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { ActivityInputSchema } from "@/lib/activity-schema";
import { createClient } from "@/lib/supabase/server";

export type ActivityResult = { ok: true; id?: string; forked?: boolean } | { ok: false; message: string };

const FAILED: ActivityResult = { ok: false, message: "That change couldn't be saved. Refresh and try again." };

/** Exactly one scoring mode is stored; the other column is explicitly null (DB constraint). */
function toColumns(v: z.infer<typeof ActivityInputSchema>) {
  return {
    title: v.title,
    problem: v.description,
    file_url: v.fileUrl === "" ? null : v.fileUrl,
    total_score: v.mode === "total" ? v.totalScore! : null,
    rubric: v.mode === "rubric" ? v.rubric! : null,
  };
}

// RLS (permission matrix + course ownership) is the real gate; requirePermission just redirects.

/** New activity: belongs to the section's course and is linked to that section. */
export async function createActivity(input: unknown): Promise<ActivityResult> {
  await requirePermission("activities");
  const parsed = z.object({ sectionId: z.uuid(), activity: ActivityInputSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That isn't valid." };

  const supabase = await createClient();
  const { data: section } = await supabase.from("sections").select("course_id").eq("id", parsed.data.sectionId).maybeSingle();
  if (!section) return FAILED;

  const { data, error } = await supabase
    .from("activities")
    .insert({ course_id: section.course_id, ...toColumns(parsed.data.activity) })
    .select("id")
    .single();
  if (error?.code === "22023") return { ok: false, message: "A course can have up to 500 activities." };
  if (error || !data) return FAILED;

  const link = await supabase.from("activity_sections").insert({ activity_id: data.id, section_id: parsed.data.sectionId });
  if (link.error) {
    await supabase.from("activities").delete().eq("id", data.id); // don't leave an unlinked activity
    return FAILED;
  }

  revalidatePath("/courses", "layout");
  return { ok: true, id: data.id };
}

/**
 * Edit from one section. If only this section uses the activity it is updated in place; if several
 * do, this section gets its own copy (with the edits) and is unlinked from the original.
 */
export async function updateActivity(input: unknown): Promise<ActivityResult> {
  await requirePermission("activities");
  const parsed = z.object({ id: z.uuid(), sectionId: z.uuid(), activity: ActivityInputSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That isn't valid." };

  const c = toColumns(parsed.data.activity);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fork_activity", {
    p_activity: parsed.data.id,
    p_section: parsed.data.sectionId,
    p_title: c.title,
    p_problem: c.problem,
    p_file_url: c.file_url,
    p_total: c.total_score,
    p_rubric: c.rubric,
  });
  if (error?.code === "55006") {
    return { ok: false, message: "This activity can't be edited because some students are already checked. Clear their checks first." };
  }
  if (error || typeof data !== "string") return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true, id: data, forked: data !== parsed.data.id };
}

/** Reuse: link an existing activity of the same course to this section (the DB enforces same course). */
export async function linkActivity(input: unknown): Promise<ActivityResult> {
  await requirePermission("activities");
  const parsed = z.object({ activityId: z.uuid(), sectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { error } = await supabase
    .from("activity_sections")
    .insert({ activity_id: parsed.data.activityId, section_id: parsed.data.sectionId });
  if (error?.code === "23505") return { ok: false, message: "This section already has that activity." };
  if (error) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

/** Remove from this section only. The database deletes the activity when its last section is removed. */
export async function unlinkActivity(input: unknown): Promise<ActivityResult> {
  await requirePermission("activities");
  const parsed = z.object({ activityId: z.uuid(), sectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_sections")
    .delete()
    .eq("activity_id", parsed.data.activityId)
    .eq("section_id", parsed.data.sectionId)
    .select("activity_id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}
