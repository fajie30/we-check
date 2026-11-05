# WeCheck: session handoff

Read this first in a new chat. It records what was built, how it works, how to run and test it, and what is still open.
The longer reference (database details, security evidence) is in [auth-phase1.md](auth-phase1.md).
The original task is in `MD-specs/auth-teacher-approval-spec.md`.

- **Live site:** https://we-check.vercel.app (Vercel project `we-check`, auto-deploys on push to `main`)
- **Repo:** https://github.com/fajie30/we-check
- **Database:** Supabase project `supabase-sky-prism` (ref `msevsednbknrshpxhxgr`, region ap-southeast-1)
- **Stack:** Next.js 16.4.4 (App Router, Turbopack, Cache Components), React 19, TypeScript, Tailwind 4,
  shadcn/ui (preset `base-sera`, Base UI), Supabase Auth + Postgres, Zod, TanStack Query (installed, not used yet)

> `AGENTS.md` says this Next.js version has breaking changes. Read `node_modules/next/dist/docs/` before writing Next code.

---

## 1. What exists now

| Area | What it does |
|---|---|
| Registration and sign-in | `/register`, `/login`, email verification (`/auth/callback`, `/verify-email` with resend), sign out |
| Approval | New teachers are `pending_approval`; the admin approves or rejects (with optional reason). Verifying email never approves |
| Admin area | `/admin` (counts), `/admin/teachers` (**Users**), `/admin/roles` |
| Users page | Filters (All, Pending, Approved, Rejected, Deactivated), search, role dropdown per person, **Actions dropdown** (Approve, Reject, Edit details, Password link, Deactivate/Reactivate), **Add user** (invite link) |
| Roles | Dynamic roles table. Admin and Teacher are system roles. Admin can add (optionally copying another role's modules), rename and delete custom roles. A **Head** role exists (Teacher modules + Head tools) |
| Permission matrix | `/admin/roles` switches which modules each role can use. System modules are locked to the admin |
| Courses and sections | `/courses`, `/courses/[id]`. A course has any number of sections (A, B, C, D), added in bulk, renamed, removed. Teachers own their courses; the admin sees all |
| Landing pages | `/instructor` (teacher dashboard), `/home` (modules a role may open), `/pending-approval`, `/rejected`, `/deactivated`, `/set-password` |
| Shared sidebar | One sidebar for the admin and every approved role, built from the role's permissions. Pending/rejected/deactivated users get a simple one-card screen |

### How people get in
- **Self sign-up:** always creates a Teacher in `pending_approval`. Role and status can't be influenced from the form.
- **Admin adds a user:** creates an already-approved account and shows a one-time invite link to copy (no email service needed). The person opens it, `/auth/confirm` verifies the token on the server, and `/set-password` lets them choose a password.
- **Admin account:** one only (database enforces it). Created once by hand, see `supabase/ADMIN_BOOTSTRAP.md`.

### Access model (important)
`src/lib/auth/access.ts` decides everything. States: `anon`, `no_profile`, `unverified`, `pending`, `rejected`,
`deactivated`, `member` (approved non-admin, any role), `admin`. A member's pages come from their role's
**permissions** (`my_permissions()` in the database). Guards: `requireAdmin`, `requireMember`, `requirePermission(key)`, etc.
Every page and server action re-checks on the server; `src/proxy.ts` is only a fast redirect for signed-out visitors.

Modules (permission keys): `teacher_approvals` and `role_management` (system, admin only), `instructor_dashboard`,
`courses`, `sections` (built), `activities`, `grading`, `head_tools` (placeholders, "Coming soon").

---

## 2. Where things are

```
src/app/(app)/            shared sidebar layout: admin/, courses/, home/, instructor/
src/app/{login,register,verify-email,pending-approval,rejected,deactivated,set-password}/
src/app/auth/{callback,confirm}/route.ts
src/proxy.ts              optimistic redirect only (Next 16 name for middleware)
src/lib/auth/             access.ts (state + guards), actions.ts, schemas.ts, permissions.ts, redirects.ts
src/lib/admin/            teachers.ts (user list), roles.ts (matrix)
src/lib/courses.ts, src/lib/sections.ts
src/lib/supabase/         server.ts, client.ts, proxy.ts, env.ts, admin.ts (service-role, see below)
src/components/{app,admin,auth,courses,ui}/
supabase/migrations/      6 SQL files (all applied)
supabase/tests/           early SQL test notes
scripts/verify/           7 test scripts (see section 4)
docs/                     auth-phase1.md (reference), this file
```

### Database migrations (all applied to the live project, in order)
1. `20261105000000_auth_profiles_approval.sql`: profiles, audit log, signup trigger, column protection, RLS, `review_instructor`
2. `20261105010000_admin_list_instructors.sql`
3. `20261105020000_role_permissions.sql`: permissions, role grants, `my_permissions`, `has_permission`, `admin_set_role_permission`
4. `20261105030000_dynamic_roles.sql`: `roles` table, role CRUD and assignment functions, `admin_list_users`, `my_modules`
5. `20261105040000_user_management.sql`: deactivation columns, `admin_prepare_user`, `admin_update_user`, `admin_set_user_active`, email-sync trigger
6. `20261105050000_courses_sections.sql`: `courses`, `sections`, RLS using the permission matrix + ownership

Cleanup still owed: drop the old `admin_list_instructors()` function (superseded by `admin_list_users()`).

---

## 3. Run it

```bash
npm run dev            # http://localhost:3000
npm run build          # production build
npx tsc --noEmit && npx eslint .
```

`.env.local` (git-ignored) needs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, and server-only `SUPABASE_SERVICE_ROLE_KEY`. It was originally pulled from Vercel.
Never prefix a secret with `NEXT_PUBLIC_`.

### The service-role key
Used in exactly one file, `src/lib/supabase/admin.ts`, imported only by
`src/app/(app)/admin/teachers/user-actions.ts`, and only for Supabase Auth operations (invite, change email, ban/unban),
after `requireAdmin()` + `requirePermission()`. All data changes go through admin-checked database functions with the
admin's own session. It must exist in Vercel (Production) too. It is not in the client bundle (verified).

---

## 4. Tests (299 checks, all passing at the end of the session)

With the dev server running, from the project root:

| Script | Checks | Covers |
|---|---|---|
| `verify.cjs` | 48 | Sign-up, tampered metadata, RLS, pending/rejected/approved page access |
| `verify-admin.cjs` | 27 | Admin pages, live approve/reject action |
| `verify-roles.cjs` | 39 | Permission matrix |
| `verify-dynamic-roles.cjs` | 63 | Create/rename/delete roles, assign users, `/home` |
| `verify-users.cjs` | 54 | Add (invite link), edit, deactivate, password links |
| `verify-courses.cjs` | 57 | Courses/sections, ownership, permissions, deactivation |
| `verify-sidebar.cjs` | 11 | Who sees which sidebar items |

They create throwaway users with the service-role key from `.env.local`, attack the real API and pages, then clean up
(and restore any matrix changes). Run them after any change to auth, roles, or courses. Run one at a time:
`node scripts/verify/verify-courses.cjs`.

---

## 5. Gotchas learned (save time next session)

- **Applying SQL:** the `apply_migration` tool is blocked by the auto-mode classifier. Write the migration file, then
  ask the user to paste it into the Supabase dashboard SQL Editor and confirm; verify afterwards with `execute_sql`.
  Or the user can add a permission rule for `mcp__claude_ai_Supabase__apply_migration`.
- **Deploy order:** if new code reads new database columns, apply the migration BEFORE running/pushing that code.
  (Once, unapplied `deactivated_at` made every profile read fail and `/login` looped; `redirectIfSignedIn` now ignores
  `no_profile` so it can't loop again.)
- **Cache Components:** any component reading cookies/session must sit inside `<Suspense>`. The server Supabase client
  calls `connection()` so session checks never run at prerender (otherwise Next throws "unstable value Date.now()").
- **Dev server and server actions:** test scripts read action IDs from `.next/dev/server/server-reference-manifest.json`,
  which only lists actions after a page that uses them has been requested once.
- **Not-found pages** return status 200 (content streams in after the shell). No data leaks; tests check content.
- **Windows:** `mv` of folders under the dev server can fail; copy then delete works.
- **Supabase quirk:** `generateLink({type:'invite'})` on an already-invited email silently re-invites. `createUser`
  refuses existing emails first, so its rollback can never delete an existing user.
- **shadcn:** components come from `npx shadcn add <name>` (preset `base-sera`, imports `cn` from the `cn` package).
  Native `<select>` is used for dropdown fields (`ui/native-select.tsx`).
- Don't use "teacher" and "instructor" interchangeably in code: database key is `instructor`, label is "Teacher".

---

## 6. Open items

**You (settings, not code):**
- Supabase, Authentication, URL Configuration: Site URL `https://we-check.vercel.app` and redirect URL
  `https://we-check.vercel.app/auth/callback` (confirm this was done).
- Set up custom SMTP (Resend/Brevo/Gmail) before real teachers register; the built-in sender is very limited.
- Enable MFA on the admin account.
- Confirm "Confirm email" is ON in Supabase Auth.

**Possible next work:**
- Drop `admin_list_instructors()` (cleanup migration).
- Build the placeholder modules: activities, grading, Head tools (Head could oversee teachers' courses).
- Students/heads/schools accounts (out of scope so far). Roles are data now, so a new role is a row; the open design
  question is how those accounts get created (invite is already built).
- Course archiving instead of permanent delete; course reordering of sections.
- Password reset by the user themselves (today the admin sends a one-time password link).
- CAPTCHA on register if bot sign-ups appear; leaked-password protection (paid Supabase plan).
- Usage limits per role (e.g. a cap on courses) on top of the matrix.

**Decisions made (change if wrong):**
- A person has exactly one role; "Head = Teacher + more" is done by giving the Head role the Teacher modules.
- Teachers see only their own courses; the admin sees all.
- Deactivation is reversible, bans sign-in in Supabase Auth, and the app also blocks it on every request.
- Admin-created users are approved immediately; email counts as verified when they use the invite link.
