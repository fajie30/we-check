// Shared by the browser (quick feedback) and server actions (authoritative).
export const MAX_SECTIONS_PER_COURSE = 50;
export const MAX_SECTION_NAME = 50;

/**
 * "A, B, C, D" or one per line -> ["A", "B", "C", "D"].
 * Trims, collapses spaces, drops empties, removes case-insensitive duplicates.
 */
export function parseSectionNames(input: string): { names: string[] } | { error: string } {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of input.split(/[,\n]+/)) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > MAX_SECTION_NAME) {
      return { error: `Section names must be ${MAX_SECTION_NAME} characters or fewer.` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length > MAX_SECTIONS_PER_COURSE) {
    return { error: `A course can have up to ${MAX_SECTIONS_PER_COURSE} sections.` };
  }
  return { names };
}
