# Phase 1: Authentication and Teacher Approval

Teachers register, verify their email, then wait for the admin to approve them.
Email verification and approval are independent: verifying never approves.

## 1. Access rules

An instructor reaches `/instructor` only if **all** are true: valid server-verified session,
`auth.users.email_confirmed_at` set, `role = 'instructor'`, `approval_status = 'approved'`.

| State | Destination |
|---|---|
| Not signed in | `/login` |
| Email not verified | Cannot sign in. Login shows a notice with a resend button; `/verify-email` also has resend. |
| Verified, pending | `/pending-approval` |
| Verified, rejected | `/rejected` (reason shown if given) |
| Verified, approved | `/instructor` |
| Admin | `/admin` |

Every page re-checks this on the server (`src/lib/auth/access.ts`). `src/proxy.ts` only does a fast,
optimistic redirect for signed-out visitors.

## 2. Database changes

Files in `supabase/migrations/` (both already applied to project `supabase-sky-prism`):

1. `20261105000000_auth_profiles_approval.sql`
   - `profiles` (1:1 with `auth.users`): `role` admin|instructor, `approval_status`
     pending_approval|approved|rejected, `reviewed_by`, `reviewed_at`, `rejection_reason`.
     Partial unique index allows **one** admin. No duplicate email-verified flag.
   - `approval_audit_log`: one row per decision (who, when, reason).
   - Trigger `on_auth_user_created`: always creates `instructor` + `pending_approval`; reads only
     `full_name` from signup metadata (control chars stripped, max 100); ignores everything else.
   - Trigger `profiles_protect_columns`: the `anon`/`authenticated` roles cannot change `id`, `email`,
     `role`, `approval_status`, `reviewed_*`, `rejection_reason`, `created_at`.
   - `is_admin()`: SECURITY DEFINER, fixed `search_path`, reads `profiles.role` (never user metadata).
   - `review_instructor(target, 'approve'|'reject', reason)`: the **only** write path for approval.
     Checks admin inside the database; target must be a pending instructor; approving needs a verified
     email; updates the row and writes the audit log in one transaction.
   - RLS on both tables. Instructors read only their own profile; the admin reads all. There are no
     insert/update/delete policies, and API-role table grants are `select` only.
2. `20261105010000_admin_list_instructors.sql`
   - `admin_list_instructors()`: admin-only list including `email_verified` (the API cannot read `auth.users`).

## 3. Create the admin (one time)

See `supabase/ADMIN_BOOTSTRAP.md`. There is no public path to admin. Enable MFA on the admin account.

## 4. Environment variables

| Variable | Scope | Used by the app? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes |
| `NEXT_PUBLIC_SITE_URL` | public | yes (email links; set to the production URL on Vercel) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | **no** (only `scripts/verify/*`, local) |
| `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_*` | **server-only** | no |

Never prefix a secret with `NEXT_PUBLIC_`. On Vercel, do not add the unused server secrets unless needed.

## 5. Supabase dashboard settings

- Authentication > Providers > Email: **Confirm email ON**.
- Authentication > URL Configuration: Site URL = your site; Redirect URLs include
  `http://localhost:3000/auth/callback` and `https://<production-domain>/auth/callback`.
- Authentication > SMTP: **configure custom SMTP before real teachers register.** The built-in sender is
  heavily rate-limited and may only deliver to team-member addresses.
- Authentication > Rate Limits: keep defaults (per-IP signup/sign-in limits apply).
- Optional: CAPTCHA on sign-up; leaked-password protection (paid plans) - the advisor flags it as off.
- Admin account: enable MFA.

## 6. Manual test plan

1. **Register**: invalid inputs (short name, bad email, weak/mismatched password) show inline errors; valid
   input shows "Check your email" and does not log in.
2. **Verify**: click the email link -> lands on `/pending-approval`. An old/used link -> `/verify-email?error=link`
   with a resend form (60 s cooldown).
3. **Login before verifying**: notice + resend. Wrong password: "Invalid email or password".
4. **Pending**: `/instructor` and `/admin` bounce to `/pending-approval`.
5. **Admin**: sign in -> `/admin` counts; `/admin/teachers` filters and search; Approve is disabled for an
   unverified email; Approve/Reject open a dialog naming the teacher.
6. **After decision**: approved teacher reaches `/instructor`; rejected teacher sees `/rejected` with reason.
7. **Admin-only**: a teacher visiting `/admin` is redirected away.
8. **Sign out** ends the session; Back button does not restore access.

Automated: with the dev server running, `node scripts/verify/verify.cjs` and
`node scripts/verify/verify-admin.cjs` (create throwaway users with the service-role key from `.env.local`,
attack the real API and pages, then delete them).

## 7. Security verification report

Run 2026-11-05 against project `supabase-sky-prism` and the local dev server. Result: **75/75 checks pass**
(48 in `verify.cjs`, 27 in `verify-admin.cjs`). Test users were deleted afterwards; only the real admin remained.

| Requirement | Evidence |
|---|---|
| Unapproved instructors cannot reach `/instructor` or protected data | Pending session: `/instructor`, `/admin`, `/admin/teachers` all redirect to `/pending-approval`; responses contain no protected content. API: own row only, audit log and instructor list refused. |
| Rejected instructors have no LMS access | Rejected session: `/instructor`, `/admin`, `/admin/teachers`, `/pending-approval` all redirect to `/rejected`. Same API restrictions as pending. |
| Unverified emails cannot reach protected pages or be approved | Sign-in fails with `email_not_confirmed` (no session). Approving an unverified teacher through the live server action is refused and the row is unchanged. |
| Instructor cannot change own role/status | Real JWT, direct REST `PATCH` of `approval_status`, `role`, `reviewed_by`, plus `insert` and `delete` on `profiles`: all fail with `42501`; rows unchanged afterwards. |
| Instructor cannot read another's profile | Query for another teacher's id returns 0 rows; `select *` returns exactly 1 row (own). |
| Non-admin cannot approve/reject | RPC `review_instructor` and `admin_list_instructors` return `42501` for pending, rejected and anonymous callers. Calling the server action as a pending teacher (self-approve) or signed out changes nothing. |
| Signup cannot create an admin | User created with metadata `{role:'admin', approval_status:'approved', is_admin:true}` gets `instructor` + `pending_approval`. Exactly one admin exists; a second is blocked by the unique index. |
| Service-role key absent from client bundle | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD` values not found in `.next/static`; `src/` has no references; `.env.local` is gitignored. |
| Admin flow works end to end | Approve sets `reviewed_by`/`reviewed_at` and writes the audit row; reject stores the reason; re-deciding, bad UUID, bad decision and targeting the admin are refused. |

Build checks: `tsc --noEmit`, `eslint .`, and `next build` all pass.
Supabase security advisor: only expected warnings. The three SECURITY DEFINER functions are callable by
`authenticated` on purpose and each rejects non-admins internally; anonymous has no execute permission.
Leaked-password protection is off (paid-plan feature).

## 8. Known limitations and follow-ups

- Built-in Supabase email is rate-limited: set up custom SMTP before launch.
- Admin teacher list loads all instructors and filters in the page (fine for hundreds; move to SQL if it grows).
- Decisions are final in the UI (pending-only). Re-opening a decision needs a new function and audit entry.
- `rejection_reason` is shown to the rejected teacher, so keep reasons polite and factual.
- No MFA enforcement in-app (enable in the Supabase dashboard for the admin).
- No CAPTCHA on register/login; add Supabase CAPTCHA if bot signups appear.
- Password changes/reset flow is not part of Phase 1.
- Single admin by design; rotation steps are in `supabase/ADMIN_BOOTSTRAP.md`.
- Later phases (schools, heads, students, courses) can add roles by relaxing the `profiles.role` check
  and extending `review_instructor`-style functions; the access state machine is in one file.

## 9. Role management (added after Phase 1)

Admin page `/admin/roles` edits which modules each role may use. Roles stay fixed: **Admin** and **Teacher**
(`instructor` in the database).

- Tables: `permissions` (catalog), `role_permissions` (grants), `role_permission_changes` (audit of edits).
  Migration: `supabase/migrations/20261105020000_role_permissions.sql`.
- Modules today: Teacher approvals, Role management, Instructor dashboard, plus placeholders
  (Courses, Sections, Activities, Grading) that do nothing until built.
- **System permissions are locked** (`admin_only`): Teacher approvals and Role management are always held
  by the admin and can never be given to teachers, so the admin cannot be locked out and teachers cannot approve teachers.
- Only the admin can change the matrix: `admin_set_role_permission()` checks `is_admin()` inside the database,
  rejects locked or not-applicable cells, and logs each change. Direct writes to the tables are not granted.
- Effective permissions: `my_permissions()` / `has_permission(key)`. Pending and rejected teachers have none.
  Use `has_permission('courses')` in future RLS policies.
- In the app: `requirePermission(key)` (`src/lib/auth/access.ts`). If an approved teacher's dashboard access is
  switched off they land on `/no-access`; turning it back on restores `/instructor`.
- Verification: `node scripts/verify/verify-roles.cjs` (39 checks). It temporarily edits the real matrix and restores defaults.

Not included: per-user overrides, custom roles, or usage limits/quotas (for example a cap on courses). Those would be
new tables/columns on top of this matrix.

## 10. Dynamic roles (replaces the "fixed roles" note in section 9)

Roles are rows in `public.roles`, not hardcoded checks. Migration: `supabase/migrations/20261105030000_dynamic_roles.sql`.

- `admin` and `instructor` (shown as "Teacher") are **system roles**: they cannot be deleted, and `admin` cannot be
  assigned or renamed. Custom roles (for example **Head**) are created at `/admin/roles` ("Add role"), optionally
  copying another role's modules ("Head = Teacher + more").
- The admin assigns a role to a person from `/admin/teachers` (the Users list). Assigning a role never changes approval
  status and can never make an admin. Signup still creates Teachers only.
- Landing page: `member` = any approved, non-admin user. They land on `/instructor` if their role has the Instructor
  dashboard, otherwise `/home`, which lists the modules their role may open.
- System permissions (Teacher approvals, Role management) stay locked to the admin, so no custom role can ever hold them.
- Deleting a role is refused while anyone still has it; renaming is allowed. Max 20 roles. All changes are logged in
  `role_audit_log`.
- Database functions (all admin-only, anon refused): `admin_create_role`, `admin_update_role`, `admin_delete_role`,
  `admin_set_user_role`, `admin_list_users`; plus `my_modules()` for the signed-in user.
- Follow-up: drop the old `admin_list_instructors()` once the new app version is live everywhere.
- Verification: `node scripts/verify/verify-dynamic-roles.cjs` (63 checks). All four suites: 48 + 27 + 39 + 63.

## 11. User management: add, edit, deactivate (admin)

Users page (`/admin/teachers`). Migration: `supabase/migrations/20261105040000_user_management.sql`.

- **Add user**: name, email, role. Creates an already-approved account and shows a one-time **invite link** to send to
  the person (no email service needed). The link opens `/auth/confirm`, which verifies the token on the server and
  sends them to `/set-password` to choose their own password. The email counts as verified once the link is used.
  Existing emails are refused up front (Supabase silently re-invites unaccepted addresses).
- **Edit**: name and email. An email change is immediate and counts as verified; a trigger mirrors it into `profiles.email`.
- **Deactivate / reactivate**: reversible, deletes nothing. Blocks sign-in at the Auth level (ban) and the app also checks
  `profiles.deactivated_at` on every request (defence in depth): such a user has no permissions and sees `/deactivated`.
- **Password link**: one-time recovery link for an existing, active user.
- The admin account cannot be edited, deactivated, or given a link, and a user cannot be created as admin.
- **Service-role key**: used in exactly one server-only module, `src/lib/supabase/admin.ts`, only for Auth operations
  (invite, change email, ban/unban) and only after `requireAdmin()` + `requirePermission('teacher_approvals')`.
  All profile changes go through admin-checked database functions with the admin's own session.
  `SUPABASE_SERVICE_ROLE_KEY` must be set (server-only) in Vercel.
- Audit: `user_audit_log` (create, edit, deactivate, reactivate, reset_link).
- Verification: `node scripts/verify/verify-users.cjs` (54 checks).

## 12. Courses and sections

Pages: `/courses`, `/courses/[id]`. Migration: `supabase/migrations/20261105050000_courses_sections.sql`.

- A **course** (for example English) has any number of **sections** (A, B, C, D). Sections are added in bulk
  ("A, B, C, D" or one per line), renamed and removed at any time. Names are unique within a course, ignoring case.
  Limits: 50 sections per course, 200 courses per person.
- **Ownership:** a teacher sees and manages only their own courses. The admin sees and manages all of them and sees the
  owner. The owner of a course can never be changed. Another person's course looks exactly like a missing one.
- **Permissions:** the `courses` and `sections` modules in the role matrix gate access (turning off Sections keeps the course
  but hides its sections). Any role, including custom ones such as Head, gets it by toggling the modules on.
- **Enforced in the database:** row-level security on both tables requires the role to hold the permission AND the caller
  to own the course (or be the admin). Deactivated and unapproved users hold no permissions, so they get nothing.
- Deleting a course is permanent and removes its sections. Archiving is a possible follow-up.
- Verification: `node scripts/verify/verify-courses.cjs` (57 checks).

## 13. Shared sidebar

Every signed-in user of the app (admin and every approved role) gets the same sidebar from one layout
(`src/app/(app)/layout.tsx`). Items come from the role's permissions (`src/components/app/sidebar-loader.tsx`), so a new
module adds one line. The menu is navigation only: pages, actions and the database still enforce access. Pending, rejected
and deactivated users keep a simple one-card screen.
Verification: `node scripts/verify/verify-sidebar.cjs` (11 checks).
