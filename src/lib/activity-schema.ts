// Shared by the browser form (quick feedback) and the server actions (authoritative).
import { z } from "zod";

export const MAX_CRITERIA = 20;
export const MAX_LEVELS = 10;
export const DEFAULT_TOTAL_SCORE = 100;
export const MAX_TOTAL_SCORE = 1000;

const text = (label: string, max: number) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `${label[0].toUpperCase()}${label.slice(1)} must be ${max} characters or fewer`);

export const LevelSchema = z.object({
  label: text("a level name", 50),
  points: z.number("Enter a score for every level").min(0, "Scores can't be negative").max(1000, "Scores can't exceed 1000"),
  description: z.string().trim().max(500, "Level descriptions must be 500 characters or fewer"),
});

export const CriterionSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: text("a criterion name", 100),
    description: z.string().trim().max(500, "Criterion descriptions must be 500 characters or fewer"),
    levels: z
      .array(LevelSchema)
      .min(2, "Each criterion needs at least 2 levels")
      .max(MAX_LEVELS, `A criterion can have up to ${MAX_LEVELS} levels`),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    for (const l of c.levels) {
      const key = l.label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", message: `"${c.name}" has two levels named "${l.label}"` });
        return;
      }
      seen.add(key);
    }
  });

export const RubricSchema = z.object({
  criteria: z
    .array(CriterionSchema)
    .min(1, "A rubric needs at least 1 criterion")
    .max(MAX_CRITERIA, `A rubric can have up to ${MAX_CRITERIA} criteria`),
});

export type Level = z.infer<typeof LevelSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;

/** Highest level score of a criterion. */
export const criterionMax = (c: { levels: { points: number }[] }) =>
  c.levels.reduce((m, l) => Math.max(m, l.points), 0);

/** Rubric total = sum of each criterion's highest level. */
export const rubricTotal = (r: { criteria: { levels: { points: number }[] }[] }) =>
  Math.round(r.criteria.reduce((sum, c) => sum + criterionMax(c), 0) * 100) / 100;

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/** Optional Google Drive/Docs link. Empty string = no link. */
export const FileUrlSchema = z
  .string()
  .trim()
  .max(500, "The link must be 500 characters or fewer")
  .refine((v) => {
    if (v === "") return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && DRIVE_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  }, "Use a Google Drive link (https://drive.google.com/...)");

export const ActivityInputSchema = z
  .object({
    title: text("a title", 150).min(2, "Title must be at least 2 characters"),
    description: text("a description", 10000),
    fileUrl: FileUrlSchema,
    mode: z.enum(["total", "rubric"]),
    totalScore: z.number().gt(0, "Total score must be above 0").max(MAX_TOTAL_SCORE, `Total score can't exceed ${MAX_TOTAL_SCORE}`).optional(),
    rubric: RubricSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "total" && v.totalScore === undefined) {
      ctx.addIssue({ code: "custom", message: "Enter a total score", path: ["totalScore"] });
    }
    if (v.mode === "rubric" && v.rubric === undefined) {
      ctx.addIssue({ code: "custom", message: "Add at least one criterion", path: ["rubric"] });
    }
  });

export type ActivityInput = z.infer<typeof ActivityInputSchema>;
