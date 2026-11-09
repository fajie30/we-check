"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { readStudentSheet } from "@/lib/students-parse";
import {
  MAX_IMPORT_ROWS,
  StudentInputSchema,
  classifyRows,
  idKey,
  type ExistingMap,
  type PreviewRow,
} from "@/lib/students-schema";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type StudentResult = { ok: true } | { ok: false; message: string };
export type PreviewResult = { ok: true; rows: PreviewRow[] } | { ok: false; message: string };
export type ImportResult =
  | { ok: true; added: number; updated: number; skipped: number }
  | { ok: false; message: string };

const FAILED = { ok: false, message: "That change couldn't be saved. Refresh and try again." } as const;

// The roster lives under the 'sections' permission. RLS (permission matrix + course ownership)
// is the real gate on every statement; requirePermission just redirects signed-out callers.

/** Every student of the section's course, keyed by lower-cased ID. Null if the section isn't visible. */
async function loadCourseRoster(supabase: Supabase, sectionId: string): Promise<{ courseId: string; map: ExistingMap } | null> {
  const { data: section } = await supabase.from("sections").select("course_id").eq("id", sectionId).maybeSingle();
  if (!section) return null;
  const { data, error } = await supabase
    .from("section_students")
    .select("id, section_id, id_number, full_name, section:sections(name)")
    .eq("course_id", section.course_id);
  if (error) return null;
  const map: ExistingMap = new Map();
  for (const s of data ?? []) {
    const sec = Array.isArray(s.section) ? s.section[0] : s.section;
    map.set(idKey(s.id_number), {
      id: s.id,
      section_id: s.section_id,
      full_name: s.full_name,
      section_name: (sec as { name: string } | null)?.name ?? "?",
    });
  }
  return { courseId: section.course_id, map };
}

function duplicateMessage(map: ExistingMap | null, idNumber: string, sectionId: string): string {
  const found = map?.get(idKey(idNumber));
  if (found && found.section_id !== sectionId) return `ID ${idNumber} is already in section ${found.section_name} of this course.`;
  return `ID ${idNumber} is already in this course.`;
}

// --- Excel import: preview, then confirm ------------------------------------------------------
export async function previewStudents(formData: FormData): Promise<PreviewResult> {
  await requirePermission("sections");
  const sectionId = z.uuid().safeParse(formData.get("sectionId"));
  const file = formData.get("file");
  if (!sectionId.success || !(file instanceof File)) return { ok: false, message: "Choose a file to upload." };

  const parsed = await readStudentSheet(file);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const supabase = await createClient();
  const roster = await loadCourseRoster(supabase, sectionId.data);
  if (!roster) return FAILED;
  return { ok: true, rows: classifyRows(parsed.rows, roster.map, sectionId.data) };
}

const importSchema = z.object({
  sectionId: z.uuid(),
  // The rows the teacher confirmed (duplicates already resolved). Re-validated here regardless.
  rows: z.array(z.object({ idNumber: z.string().max(200), fullName: z.string().max(500) })).min(1).max(MAX_IMPORT_ROWS),
});

export async function importStudents(input: unknown): Promise<ImportResult> {
  await requirePermission("sections");
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return FAILED;
  const { sectionId } = parsed.data;

  // Authoritative: same ID twice in the payload -> first one wins.
  const seen = new Set<string>();
  const rows = parsed.data.rows
    .map((r, i) => ({ row: i + 2, idNumber: r.idNumber, fullName: r.fullName }))
    .filter((r) => {
      const k = idKey(r.idNumber);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const supabase = await createClient();
  const roster = await loadCourseRoster(supabase, sectionId);
  if (!roster) return FAILED;
  const classified = classifyRows(rows, roster.map, sectionId);

  const toAdd = classified.filter((r) => r.status === "new");
  const toUpdate = classified.filter((r) => r.status === "update");
  const skipped = classified.length - toAdd.length - toUpdate.length;

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("section_students")
      .insert(toAdd.map((r) => ({ section_id: sectionId, id_number: r.idNumber, full_name: r.fullName })));
    if (error?.code === "22023") return { ok: false, message: "A section can have up to 500 students." };
    if (error?.code === "23505") return { ok: false, message: "Someone else just added one of these IDs. Upload the file again." };
    if (error) return FAILED;
  }
  for (const r of toUpdate) {
    const existing = roster.map.get(idKey(r.idNumber));
    if (!existing) continue;
    const { error } = await supabase.from("section_students").update({ full_name: r.fullName }).eq("id", existing.id);
    if (error) return FAILED;
  }

  revalidatePath("/courses", "layout");
  return { ok: true, added: toAdd.length, updated: toUpdate.length, skipped };
}

// --- One at a time ----------------------------------------------------------------------------
export async function addStudent(input: unknown): Promise<StudentResult> {
  await requirePermission("sections");
  const parsed = z.object({ sectionId: z.uuid(), student: StudentInputSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That isn't valid." };
  const { sectionId, student } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("section_students")
    .insert({ section_id: sectionId, id_number: student.idNumber, full_name: student.fullName });
  if (error?.code === "23505") {
    const roster = await loadCourseRoster(supabase, sectionId);
    return { ok: false, message: duplicateMessage(roster?.map ?? null, student.idNumber, sectionId) };
  }
  if (error?.code === "22023") return { ok: false, message: "A section can have up to 500 students." };
  if (error) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

export async function updateStudent(input: unknown): Promise<StudentResult> {
  await requirePermission("sections");
  const parsed = z.object({ id: z.uuid(), sectionId: z.uuid(), student: StudentInputSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That isn't valid." };
  const { id, sectionId, student } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("section_students")
    .update({ id_number: student.idNumber, full_name: student.fullName })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") {
    const roster = await loadCourseRoster(supabase, sectionId);
    return { ok: false, message: duplicateMessage(roster?.map ?? null, student.idNumber, sectionId) };
  }
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

export async function removeStudent(input: unknown): Promise<StudentResult> {
  await requirePermission("sections");
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { data, error } = await supabase.from("section_students").delete().eq("id", parsed.data.id).select("id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}
