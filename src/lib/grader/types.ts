import { z } from "zod";

export const LevelSchema = z.object({
  label: z.string().min(1),
  points: z.number().min(0),
  description: z.string(),
});

export const CriterionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  maxPoints: z.number().positive(),
  levels: z.array(LevelSchema).optional(),
  type: z.enum(["ai", "automated", "manual"]),
});

export const RubricSchema = z.object({
  criteria: z.array(CriterionSchema).min(1),
});

export const ActivitySchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  rubric: RubricSchema,
});

export const EvidenceSchema = z.object({
  file: z.string(),
  lines: z.string().optional(),
});

export const CriterionResultSchema = z.object({
  criterionId: z.string(),
  score: z.number().min(0),
  justification: z.string(),
  evidence: z.array(EvidenceSchema),
  flagged: z.boolean(),
});

export const StudentResultSchema = z.object({
  studentName: z.string(),
  matchedToRoster: z.boolean(),
  results: z.array(CriterionResultSchema),
  total: z.number(),
  status: z.enum(["graded", "failed", "flagged"]),
  error: z.string().optional(),
  notes: z.array(z.string()).optional(),
});

export type Level = z.infer<typeof LevelSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type StudentResult = z.infer<typeof StudentResultSchema>;

/** One line of the NDJSON progress stream sent to the browser. */
export type ProgressEvent =
  | { type: "start"; total: number; unmatched: string[] }
  | { type: "student"; index: number; total: number; name: string; phase: "grading" }
  | { type: "result"; index: number; total: number; result: StudentResult }
  | { type: "done"; results: StudentResult[] }
  | { type: "error"; message: string };

/** A file that survived extraction: path is normalized, forward-slash, relative. */
export type ExtractedFile = { path: string; data: Buffer };
