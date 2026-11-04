// Open-redirect protection: only these exact internal paths are accepted
// from a `next` query parameter. Anything else is ignored.
const ALLOWED_NEXT_PATHS = new Set([
  "/instructor",
  "/admin",
  "/admin/teachers",
  "/pending-approval",
  "/rejected",
  "/verify-email",
]);

export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  return ALLOWED_NEXT_PATHS.has(next) ? next : null;
}
