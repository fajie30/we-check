const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Upload cap in MB. Shown on the page as well. */
export const MAX_UPLOAD_MB = num(process.env.MAX_UPLOAD_MB, 200);

export const LIMITS = {
  maxUploadBytes: MAX_UPLOAD_MB * 1024 * 1024,
  /** Max total uncompressed bytes across the whole upload (zip-bomb guard). */
  maxTotalUncompressed: 1024 * 1024 * 1024,
  /** Max uncompressed bytes for a single entry. */
  maxFileBytes: 20 * 1024 * 1024,
  /** Max entries per archive. */
  maxFiles: 50_000,
  /** Max compression ratio per entry. */
  maxRatio: 200,
  /** Max nested zip depth (outer zip -> student zips). */
  maxDepth: 2,
  /** Per-file text cap sent to the grader. */
  maxFileChars: 30_000,
  /** Total characters of project context sent per student (~4 chars/token). */
  contextCharBudget: 240_000,
};

export const GRADER_MODEL = process.env.GRADER_MODEL || "claude-opus-5-5";
