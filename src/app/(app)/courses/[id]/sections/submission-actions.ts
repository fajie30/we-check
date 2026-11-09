"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { RubricSchema } from "@/lib/activity-schema";
import { readLinkSheet } from "@/lib/students-parse";
import { MAX_IMPORT_ROWS, idKey } from "@/lib/students-schema";
import {
  LinkSchema,
  MAX_REMARKS,
  classifyLinks,
  computeCheck,
  type LinkPreviewRow,
  type RosterEntry,
} from "@/lib/submissions-schema";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type SubmissionResult = { ok: true } | { ok: false; message: string };
export type LinkPreviewResult = { ok: true; rows: LinkPreviewRow[] } | { ok: false; message: string };
export type LinkImportResult = { ok: true; added: number; skipped: number } | { ok: false; message: string };

const FAILED = { ok: false, message: "That change couldn't be saved. Refresh and try again." } as const;

// RLS (permission matrix + course ownership) is the real gate; requirePermission just redirects.

/** The section's roster and the links already attached for the activity. Null if not visible. */
async function loadContext(supabase: Supabase, activityId: string, sectionId: string) {
  const link = await supabase
    .from("activity_sections")
    .select("activity_id")
    .eq("activity_id", activityId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (link.error || !link.data) return null;

  const [roster, subs] = await Promise.all([
    supabase.from("section_students").select("id, id_number, full_name").eq("section_id", sectionId),
    supabase.from("student_submissions").select("student_id, link_url").eq("activity_id", activityId),
  ]);
  if (roster.error || subs.error) return null;

  const byId = new Map<string, RosterEntry>();
  for (const s of roster.data ?? []) byId.set(idKey(s.id_number), { id: s.id, full_name: s.full_name });
  const links = new Map<string, string>();
  for (const s of subs.data ?? []) if (s.link_url) links.set(s.student_id as string, s.link_url as string);
  return { roster: byId, links };
}

// --- Links: Excel (preview, then confirm) -----------------------------------------------------
export async function previewLinks(formData: FormData): Promise<LinkPreviewResult> {
  await requirePermission("activities");
  const ids = z.object({ activityId: z.uuid(), sectionId: z.uuid() }).safeParse({
    activityId: formData.get("activityId"),
    sectionId: formData.get("sectionId"),
  });
  const file = formData.get("file");
  if (!ids.success || !(file instanceof File)) return { ok: false, message: "Choose a file to upload." };

  const parsed = await readLinkSheet(file);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const supabase = await createClient();
  const ctx = await loadContext(supabase, ids.data.activityId, ids.data.sectionId);
  if (!ctx) return FAILED;
  return { ok: true, rows: classifyLinks(parsed.rows, ctx.roster, ctx.links) };
}

export async function importLinks(input: unknown): Promise<LinkImportResult> {
  await requirePermission("activities");
  const parsed = z
    .object({
      activityId: z.uuid(),
      sectionId: z.uuid(),
      rows: z.array(z.object({ idNumber: z.string().max(200), link: z.string().max(1000) })).min(1).max(MAX_IMPORT_ROWS),
    })
    .safeParse(input);
  if (!parsed.success) return FAILED;
  const { activityId, sectionId } = parsed.data;

  // Authoritative: same ID twice in the payload -> first one wins.
  const seen = new Set<string>();
  const rows = parsed.data.rows
    .map((r, i) => ({ row: i + 2, idNumber: r.idNumber, link: r.link }))
    .filter((r) => (seen.has(idKey(r.idNumber)) ? false : (seen.add(idKey(r.idNumber)), true)));

  const supabase = await createClient();
  const ctx = await loadContext(supabase, activityId, sectionId);
  if (!ctx) return FAILED;
  const classified = classifyLinks(rows, ctx.roster, ctx.links);
  const toAdd = classified.filter((r) => r.status === "new");

  if (toAdd.length > 0) {
    const payload = toAdd.flatMap((r) => {
      const student = ctx.roster.get(idKey(r.idNumber));
      return student ? [{ activity_id: activityId, student_id: student.id, link_url: r.link }] : [];
    });
    // Link only: a student's check (if any) is untouched.
    const { error } = await supabase.from("student_submissions").upsert(payload, { onConflict: "activity_id,student_id" });
    if (error) return FAILED;
  }

  revalidatePath("/courses", "layout");
  return { ok: true, added: toAdd.length, skipped: classified.length - toAdd.length };
}

// --- Links: one student ---------------------------------------------------------------------------
export async function setLink(input: unknown): Promise<SubmissionResult> {
  await requirePermission("activities");
  const parsed = z
    .object({ activityId: z.uuid(), studentId: z.uuid(), link: z.string().max(1000) })
    .safeParse(input);
  if (!parsed.success) return FAILED;
  const raw = parsed.data.link.trim();

  const supabase = await createClient();
  if (raw === "") {
    // Clear the link; keep the row only if it still holds a check.
    const { error } = await supabase
      .from("student_submissions")
      .update({ link_url: null })
      .eq("activity_id", parsed.data.activityId)
      .eq("student_id", parsed.data.studentId);
    if (error) return FAILED;
    await supabase
      .from("student_submissions")
      .delete()
      .eq("activity_id", parsed.data.activityId)
      .eq("student_id", parsed.data.studentId)
      .is("link_url", null)
      .is("checked_at", null);
  } else {
    const link = LinkSchema.safeParse(raw);
    if (!link.success) return { ok: false, message: link.error.issues[0]?.message ?? "That isn't a valid link." };
    const { error } = await supabase
      .from("student_submissions")
      .upsert(
        { activity_id: parsed.data.activityId, student_id: parsed.data.studentId, link_url: link.data },
        { onConflict: "activity_id,student_id" },
      );
    if (error) return FAILED;
  }

  revalidatePath("/courses", "layout");
  return { ok: true };
}

// --- Checking ---------------------------------------------------------------------------------------
const checkSchema = z.object({
  activityId: z.uuid(),
  studentId: z.uuid(),
  picks: z.record(z.string(), z.string()).optional(),
  score: z.number().optional(),
  remarks: z.string().trim().max(MAX_REMARKS, `Remarks must be ${MAX_REMARKS} characters or fewer`).optional(),
});

/** Save a student's check. The score is computed here from the activity, never trusted from the browser. */
export async function saveCheck(input: unknown): Promise<SubmissionResult> {
  await requirePermission("activities");
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That isn't valid." };
  const { activityId, studentId, picks, score, remarks } = parsed.data;

  const supabase = await createClient();
  const { data: activity, error: aErr } = await supabase
    .from("activities")
    .select("total_score, rubric")
    .eq("id", activityId)
    .maybeSingle();
  if (aErr || !activity) return FAILED;
  const rubric = activity.rubric == null ? null : RubricSchema.safeParse(activity.rubric);

  const result = computeCheck(
    { rubric: rubric && rubric.success ? rubric.data : null, total_score: activity.total_score == null ? null : Number(activity.total_score) },
    { picks, score },
  );
  if (!result.ok) return { ok: false, message: result.message };

  const { error } = await supabase.from("student_submissions").upsert(
    {
      activity_id: activityId,
      student_id: studentId,
      checked_at: new Date().toISOString(),
      total_score: result.total,
      selections: result.selections,
      remarks: remarks === "" ? null : (remarks ?? null),
    },
    { onConflict: "activity_id,student_id" },
  );
  if (error) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

/** Undo a check (the student goes back to "Not checked", 0). The link stays. Unlocks editing again. */
export async function clearCheck(input: unknown): Promise<SubmissionResult> {
  await requirePermission("activities");
  const parsed = z.object({ activityId: z.uuid(), studentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_submissions")
    .update({ checked_at: null, total_score: null, selections: null, remarks: null })
    .eq("activity_id", parsed.data.activityId)
    .eq("student_id", parsed.data.studentId)
    .select("activity_id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}
