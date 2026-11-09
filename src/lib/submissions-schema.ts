// Shared by the browser (quick feedback) and the server actions (authoritative).
import { z } from "zod";
import type { Rubric } from "@/lib/activity-schema";
import { FileUrlSchema } from "@/lib/activity-schema";
import { IdNumberSchema, idKey } from "@/lib/students-schema";

export const MAX_REMARKS = 500;

/** A required Google Drive/Docs link (the activity form's link is optional; a student's is not). */
export const LinkSchema = FileUrlSchema.refine((v) => v !== "", "Enter a Google Drive link");

// --- A saved check -----------------------------------------------------------------------------
/** The level the teacher picked, copied at save time so later rubric edits can't change a past score. */
export type Snapshot = {
  criterionId: string;
  criterionName: string;
  levelLabel: string;
  points: number;
  maxPoints: number;
};

export const SnapshotSchema = z.object({
  criterionId: z.string(),
  criterionName: z.string(),
  levelLabel: z.string(),
  points: z.number(),
  maxPoints: z.number(),
});

type Scoring = { rubric: Rubric | null; total_score: number | null };

/** Maximum score of an activity. */
export const maxScore = (a: Scoring) =>
  a.rubric
    ? Math.round(a.rubric.criteria.reduce((s, c) => s + Math.max(...c.levels.map((l) => l.points)), 0) * 100) / 100
    : (a.total_score ?? 0);

export type CheckInput = {
  /** Rubric activity: criterionId -> chosen level label. A criterion with no pick counts 0. */
  picks?: Record<string, string>;
  /** Total-score activity: the score. */
  score?: number;
};

export function computeCheck(
  activity: Scoring,
  input: CheckInput,
): { ok: true; total: number; selections: Snapshot[] | null } | { ok: false; message: string } {
  if (activity.rubric) {
    const selections: Snapshot[] = [];
    for (const c of activity.rubric.criteria) {
      const label = input.picks?.[c.id];
      if (label === undefined) continue;
      const level = c.levels.find((l) => l.label === label);
      if (!level) return { ok: false, message: `"${c.name}" has no level "${label}". Reload the page.` };
      selections.push({
        criterionId: c.id,
        criterionName: c.name,
        levelLabel: level.label,
        points: level.points,
        maxPoints: Math.max(...c.levels.map((l) => l.points)),
      });
    }
    const total = Math.round(selections.reduce((s, x) => s + x.points, 0) * 100) / 100;
    return { ok: true, total, selections };
  }
  const max = activity.total_score ?? 0;
  const score = input.score;
  if (score === undefined || !Number.isFinite(score)) return { ok: false, message: "Enter a score" };
  if (score < 0 || score > max) return { ok: false, message: `Score must be between 0 and ${max}` };
  return { ok: true, total: Math.round(score * 100) / 100, selections: null };
}

// --- Links Excel preview -----------------------------------------------------------------------
/**
 *  new           - student has no link yet: will be attached
 *  same          - student already has exactly this link
 *  has_link      - student already has a different link: skipped (edit it on the student instead)
 *  not_in_roster - ID isn't in this section's roster: skipped
 *  invalid       - missing ID, or link isn't a Google Drive/Docs link: skipped
 */
export type LinkStatus = "new" | "same" | "has_link" | "not_in_roster" | "invalid";

export type LinkPreviewRow = {
  row: number;
  idNumber: string;
  link: string;
  studentName?: string;
  status: LinkStatus;
  message?: string;
  /** Set when this ID appears more than once in the file. */
  dupKey?: string;
};

export type RosterEntry = { id: string; full_name: string };

export function classifyLinks(
  rows: { row: number; idNumber: string; link: string }[],
  roster: Map<string, RosterEntry>,
  currentLinks: Map<string, string>, // studentId -> link already attached
): LinkPreviewRow[] {
  const out: LinkPreviewRow[] = rows.map((r) => {
    const id = IdNumberSchema.safeParse(r.idNumber);
    const link = LinkSchema.safeParse(r.link);
    if (!id.success || !link.success) {
      return {
        row: r.row,
        idNumber: r.idNumber,
        link: r.link,
        status: "invalid" as const,
        message: (!id.success ? id.error.issues[0]?.message : link.success ? undefined : link.error.issues[0]?.message) ?? "Invalid row",
      };
    }
    const student = roster.get(idKey(id.data));
    const base = { row: r.row, idNumber: id.data, link: link.data };
    if (!student) return { ...base, status: "not_in_roster" as const, message: "Not in this section's roster" };
    const existing = currentLinks.get(student.id);
    if (existing === undefined) return { ...base, studentName: student.full_name, status: "new" as const };
    return existing === link.data
      ? { ...base, studentName: student.full_name, status: "same" as const }
      : { ...base, studentName: student.full_name, status: "has_link" as const, message: "Already has a different link" };
  });

  const groups = new Map<string, LinkPreviewRow[]>();
  for (const r of out) {
    if (r.status === "invalid" || r.status === "not_in_roster") continue;
    const k = idKey(r.idNumber);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, list] of groups) if (list.length > 1) for (const r of list) r.dupKey = k;
  return out;
}
