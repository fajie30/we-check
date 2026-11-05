import "server-only";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type CourseRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  owner_name: string | null;
  section_count: number;
};

export type SectionRow = { id: string; name: string };

export type CourseDetail = {
  id: string;
  name: string;
  description: string | null;
  owner_name: string | null;
  sections: SectionRow[];
  canEditSections: boolean;
};

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Courses the caller may see. RLS does the filtering: teachers get their own, the
 * admin gets all of them. The permission check here just gives a clean redirect.
 */
export async function getCourses(): Promise<
  { courses: CourseRow[]; isAdmin: boolean; canCreateSections: boolean } | { error: true }
> {
  const state = await requirePermission("courses");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, name, description, created_at, owner:profiles(full_name), sections(count)")
    .order("created_at", { ascending: false });
  if (error || !data) return { error: true };

  const courses = data.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    created_at: c.created_at,
    owner_name: one(c.owner as Embedded<{ full_name: string }>)?.full_name ?? null,
    section_count: one(c.sections as Embedded<{ count: number }>)?.count ?? 0,
  }));
  return {
    courses,
    isAdmin: state.kind === "admin",
    canCreateSections: state.permissions.includes("sections"),
  };
}

/** One course, or null if it doesn't exist or isn't the caller's (RLS hides it). */
export async function getCourse(id: string): Promise<CourseDetail | null | { error: true }> {
  const state = await requirePermission("courses");
  if (!z.uuid().safeParse(id).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, name, description, owner:profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: true };
  if (!data) return null;

  const canEditSections = state.permissions.includes("sections");
  let sections: SectionRow[] = [];
  if (canEditSections) {
    const res = await supabase
      .from("sections")
      .select("id, name")
      .eq("course_id", id)
      .order("created_at")
      .order("name");
    if (res.error) return { error: true };
    sections = res.data ?? [];
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    owner_name: state.kind === "admin" ? (one(data.owner as Embedded<{ full_name: string }>)?.full_name ?? null) : null,
    sections,
    canEditSections,
  };
}
