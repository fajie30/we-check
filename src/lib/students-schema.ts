// Shared by the browser (quick feedback) and the server actions (authoritative).
import { z } from "zod";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const IdNumberSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "ID number is missing").max(30, "ID number must be 30 characters or fewer"));

export const FullNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2, "Full name must be at least 2 characters").max(150, "Full name must be 150 characters or fewer"));

export const StudentInputSchema = z.object({ idNumber: IdNumberSchema, fullName: FullNameSchema });

/** Case-insensitive key: the database treats "a1" and "A1" as the same ID. */
export const idKey = (id: string) => id.trim().toLowerCase();

/**
 * How a spreadsheet row relates to the course roster:
 *  new       - ID not in the course: will be added to this section
 *  update    - ID already in THIS section with a different name: name will be updated
 *  unchanged - ID already in this section with the same name: nothing to do
 *  conflict  - ID already in ANOTHER section of this course: skipped
 *  invalid   - missing/too-long ID or name: skipped
 */
export type PreviewStatus = "new" | "update" | "unchanged" | "conflict" | "invalid";

export type PreviewRow = {
  /** Spreadsheet row number (header is row 1). */
  row: number;
  idNumber: string;
  fullName: string;
  status: PreviewStatus;
  message?: string;
  /** Set when this ID appears more than once in the file; rows with the same key are one group. */
  dupKey?: string;
};

export type ExistingStudent = { id: string; section_id: string; full_name: string; section_name: string };
export type ExistingMap = Map<string, ExistingStudent>;

/** Classify rows against the course roster. Pure, so the server can re-run it at import time. */
export function classifyRows(
  rows: { row: number; idNumber: string; fullName: string }[],
  existing: ExistingMap,
  sectionId: string,
): PreviewRow[] {
  const out: PreviewRow[] = rows.map((r) => {
    const id = IdNumberSchema.safeParse(r.idNumber);
    const name = FullNameSchema.safeParse(r.fullName);
    if (!id.success || !name.success) {
      return {
        row: r.row,
        idNumber: r.idNumber,
        fullName: r.fullName,
        status: "invalid" as const,
        message: (!id.success ? id.error.issues[0]?.message : name.success ? undefined : name.error.issues[0]?.message) ?? "Invalid row",
      };
    }
    const found = existing.get(idKey(id.data));
    if (!found) return { row: r.row, idNumber: id.data, fullName: name.data, status: "new" as const };
    if (found.section_id !== sectionId) {
      return {
        row: r.row,
        idNumber: id.data,
        fullName: name.data,
        status: "conflict" as const,
        message: `Already in section ${found.section_name} of this course`,
      };
    }
    return found.full_name === name.data
      ? { row: r.row, idNumber: id.data, fullName: name.data, status: "unchanged" as const }
      : { row: r.row, idNumber: id.data, fullName: name.data, status: "update" as const, message: `Was "${found.full_name}"` };
  });

  // Flag IDs repeated inside the file (valid-shaped rows only).
  const groups = new Map<string, PreviewRow[]>();
  for (const r of out) {
    if (r.status === "invalid") continue;
    const k = idKey(r.idNumber);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, list] of groups) {
    if (list.length > 1) for (const r of list) r.dupKey = k;
  }
  return out;
}
