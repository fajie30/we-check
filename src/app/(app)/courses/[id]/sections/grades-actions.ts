"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth/access";
import { getSectionGrades } from "@/lib/grades";
import { buildGradesWorkbook } from "@/lib/grades-export";

export type GradesExport = { ok: true; filename: string; base64: string } | { ok: false; message: string };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "section";

/** Built on the server from the database (never from what the browser shows), then handed back to download. */
export async function exportGrades(input: unknown): Promise<GradesExport> {
  await requirePermission("sections");
  const parsed = z.object({ sectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Couldn't build the file. Refresh and try again." };

  const data = await getSectionGrades(parsed.data.sectionId);
  if (data === null || "error" in data) return { ok: false, message: "Couldn't build the file. Refresh and try again." };

  const file = await buildGradesWorkbook(data);
  return {
    ok: true,
    filename: `grades-${slug(data.courseName)}-${slug(data.sectionName)}.xlsx`,
    base64: file.toString("base64"),
  };
}
