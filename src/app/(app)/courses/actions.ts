"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { parseSectionNames } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";

export type CourseResult = { ok: true; id?: string } | { ok: false; message: string };

const FAILED: CourseResult = { ok: false, message: "That change couldn't be saved. Refresh and try again." };

// Authorization is enforced by the database (RLS + permission matrix) on every
// statement below. requirePermission() just gives signed-out/unauthorised callers a redirect.

const name = z.string().trim().min(2, "Course name must be at least 2 characters").max(100, "Course name must be 100 characters or fewer");
const description = z.string().trim().max(500, "Description must be 500 characters or fewer").optional();
const sectionName = z.string().trim().min(1, "Enter a section name").max(50, "Section names must be 50 characters or fewer");

const firstIssue = (e: z.ZodError): CourseResult => ({ ok: false, message: e.issues[0]?.message ?? "That isn't valid." });

function sectionError(code: string | undefined): CourseResult {
  if (code === "23505") return { ok: false, message: "A section with that name already exists in this course." };
  if (code === "22023") return { ok: false, message: "A course can have up to 50 sections." };
  return FAILED;
}

// --- Courses ----------------------------------------------------------------
const createSchema = z.object({ name, description, sections: z.string().max(5000).optional() });

export async function createCourse(input: unknown): Promise<CourseResult> {
  const state = await requirePermission("courses");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const names = parseSectionNames(parsed.data.sections ?? "");
  if ("error" in names) return { ok: false, message: names.error };
  if (names.names.length > 0 && !state.permissions.includes("sections")) {
    return { ok: false, message: "Your role can't manage sections." };
  }

  const supabase = await createClient();
  const { data: course, error } = await supabase
    .from("courses")
    .insert({ owner_id: state.profile.id, name: parsed.data.name, description: parsed.data.description || null })
    .select("id")
    .single();
  if (error || !course) {
    if (error?.code === "22023") return { ok: false, message: "You've reached the limit of 200 courses." };
    return FAILED;
  }

  if (names.names.length > 0) {
    const { error: secError } = await supabase
      .from("sections")
      .insert(names.names.map((n) => ({ course_id: course.id, name: n })));
    if (secError) {
      await supabase.from("courses").delete().eq("id", course.id); // don't leave a half-made course
      return sectionError(secError.code);
    }
  }

  revalidatePath("/courses", "layout");
  return { ok: true, id: course.id };
}

const updateSchema = z.object({ id: z.uuid(), name, description });

export async function updateCourse(input: unknown): Promise<CourseResult> {
  await requirePermission("courses");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .update({ name: parsed.data.name, description: parsed.data.description || null })
    .eq("id", parsed.data.id)
    .select("id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

export async function deleteCourse(input: unknown): Promise<CourseResult> {
  await requirePermission("courses");
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { data, error } = await supabase.from("courses").delete().eq("id", parsed.data.id).select("id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

// --- Sections ---------------------------------------------------------------
export async function addSections(input: unknown): Promise<CourseResult> {
  await requirePermission("sections");
  const parsed = z.object({ courseId: z.uuid(), names: z.string().max(5000) }).safeParse(input);
  if (!parsed.success) return FAILED;

  const names = parseSectionNames(parsed.data.names);
  if ("error" in names) return { ok: false, message: names.error };
  if (names.names.length === 0) return { ok: false, message: "Enter at least one section name." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .insert(names.names.map((n) => ({ course_id: parsed.data.courseId, name: n })))
    .select("id");
  if (error) return sectionError(error.code);
  if (!data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

export async function renameSection(input: unknown): Promise<CourseResult> {
  await requirePermission("sections");
  const parsed = z.object({ id: z.uuid(), name: sectionName }).safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .update({ name: parsed.data.name.replace(/\s+/g, " ") })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return sectionError(error.code);
  if (!data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}

export async function deleteSection(input: unknown): Promise<CourseResult> {
  await requirePermission("sections");
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return FAILED;

  const supabase = await createClient();
  const { data, error } = await supabase.from("sections").delete().eq("id", parsed.data.id).select("id");
  if (error || !data || data.length === 0) return FAILED;

  revalidatePath("/courses", "layout");
  return { ok: true };
}
