// Permission keys. Must match public.permissions.key in the database.
// Roles are NOT listed here: they are rows in public.roles and can be added at runtime.
export const PERMISSION_KEYS = [
  "teacher_approvals",
  "role_management",
  "instructor_dashboard",
  "head_tools",
  "courses",
  "sections",
  "activities",
  "grading",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// Same rule as the database check on roles.key.
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;

/** "Head of Dept." -> "head_of_dept" (valid role key). */
export function slugifyRoleKey(label: string): string {
  let key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(key)) key = `r_${key}`;
  return key.slice(0, 31).replace(/_+$/, "");
}
