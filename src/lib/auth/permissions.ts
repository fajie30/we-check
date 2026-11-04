// Permission keys. Must match public.permissions.key in the database.
export const PERMISSION_KEYS = [
  "teacher_approvals",
  "role_management",
  "instructor_dashboard",
  "courses",
  "sections",
  "activities",
  "grading",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ROLES = ["admin", "instructor"] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  admin: "Admin",
  instructor: "Teacher",
};
