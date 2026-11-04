# Task: Authentication & Teacher Account Approval (LMS Phase 1)

This is Phase 1 of a multi-school LMS. Focus ONLY on authentication, teacher registration, and Admin approval. Security and correct approval behavior matter more than speed.

---

## 0. How to Work (Read First)

1. **Do not write code until Step A is approved.**
2. Work in the stages below. At the end of each stage, **stop, summarize, and wait for my approval**.
3. Use the existing project setup. Do not reinstall, replace, or reconfigure existing dependencies unless you ask first and explain why.
4. If something in this spec is ambiguous, conflicts with the installed versions, or you see a safer approach, **ask or flag it** instead of guessing.
5. Never put secrets in chat output, committed files, or client code.

### Stages

| Stage | Name                        | Output                                                           | Gate              |
| ----- | --------------------------- | ---------------------------------------------------------------- | ----------------- |
| A     | Inspection & Proposal       | Findings + proposed schema, RLS, admin bootstrap plan (no code)  | Wait for approval |
| B     | Database                    | SQL migrations (tables, trigger, RLS, protections)               | Wait for approval |
| C     | Auth plumbing               | Supabase clients, session handling, route guards, server helpers | Wait for approval |
| D     | Registration & verification | `/register`, `/login`, email callback, `/pending-approval`       | Wait for approval |
| E     | Admin                       | `/admin`, `/admin/teachers`, approve/reject with dialogs         | Wait for approval |
| F     | Instructor & verification   | `/instructor`, full security verification, docs                  | Final review      |

---

## 1. Existing Tech Stack

Already configured / available:

- Next.js (App Router assumed; confirm in Stage A)
- TypeScript
- Tailwind CSS
- shadcn/ui (with template)
- Supabase (PostgreSQL + Auth)
- TanStack Query
- Zod
- Vercel
- GitHub

---

## 2. Stage A — Inspection & Proposal (No Code)

Before writing any code:

1. Inspect the project structure.
2. Report the installed versions of Next.js, React, `@supabase/supabase-js`, and `@supabase/ssr` (or whichever Supabase auth helper is installed). Flag deprecated packages (e.g. `@supabase/auth-helpers-*`).
3. Review the current Supabase setup: existing tables, existing RLS, existing triggers, auth settings.
4. Report whether middleware (or `proxy.ts`, depending on Next.js version) already exists.
5. List missing environment variables and configuration (Site URL, redirect URLs, email confirmation setting, SMTP).
6. Propose:
   - Database schema
   - RLS policies
   - Database triggers and column protections
   - Admin bootstrap method
   - Route protection strategy
   - Folder/file structure for the new code
7. List open questions and risks.

**Stop and wait for approval.**

---

## 3. Roles and Statuses

### Roles

- `admin` — exactly one account for now (the project owner).
- `instructor` — teachers who register and request access.

### Approval status

- `pending_approval` (default for every new instructor)
- `approved`
- `rejected`

### Email verification

- **Never stored as a duplicate flag.** Use Supabase's own `auth.users.email_confirmed_at` as the single source of truth.
- Email verification and approval are independent. Verifying an email must NOT change approval status.

### Effective access rule

An instructor can access the Instructor Dashboard only if **all** are true:

1. A valid server-verified session exists.
2. `email_confirmed_at` is not null.
3. `role = 'instructor'`.
4. `approval_status = 'approved'`.

### Where each state sends the user

| State                            | Destination                                          |
| -------------------------------- | ---------------------------------------------------- |
| Not signed in                    | `/login`                                             |
| Signed in, email not verified    | Notice to verify email (resend option)               |
| Verified, `pending_approval`     | `/pending-approval`                                  |
| Verified, `rejected`             | Rejected notice page, no LMS access, sign-out option |
| Verified, `approved`, instructor | `/instructor`                                        |
| Admin                            | `/admin`                                             |

> Tweak note: the original spec said status "becomes" `pending_approval` after verification. Cleaner model: the profile is created at signup with `pending_approval`, and verification is checked separately. This avoids a state-sync step that can fail. Confirm this in Stage A.

---

## 4. Database Design (Proposal Guidance)

Propose, then implement after approval. Expected shape:

### `profiles` table (1:1 with `auth.users`)

- `id` uuid, primary key, references `auth.users(id)` on delete cascade
- `full_name` text, not null
- `email` text, not null (copy for display; auth.users remains the source of truth)
- `role` enum/text with check: `admin` | `instructor`
- `approval_status` enum/text with check: `pending_approval` | `approved` | `rejected`
- `reviewed_by` uuid, nullable, references `profiles(id)`
- `reviewed_at` timestamptz, nullable
- `rejection_reason` text, nullable (optional, propose whether to include)
- `created_at`, `updated_at` timestamptz

### Profile creation

- Create the profile with a database trigger on `auth.users` insert.
- The trigger must **always** set `role = 'instructor'` and `approval_status = 'pending_approval'`.
- The trigger must **ignore** any role or status passed through signup metadata. Only `full_name` may be read from metadata, and it must be length-limited and sanitized.

### Protections

- Users cannot update `role`, `approval_status`, `reviewed_by`, `reviewed_at`, or `id`/`email` on their own profile. Enforce with a trigger or column-level restrictions, **not** only RLS `with check`.
- Approval changes happen only through a server-side path that verifies the caller is the admin (see Section 7).
- Add an audit trail of approval decisions (at minimum `reviewed_by` / `reviewed_at`; propose a small `approval_audit_log` table if worthwhile).

---

## 5. Row Level Security

RLS must be enabled on every new table. Propose and justify each policy. Intent:

- **Instructor:** can `select` only their own profile row. Cannot `insert`, `delete`, or change protected columns.
- **Admin:** can `select` all profiles. Can change approval status only through the controlled path.
- **Anonymous:** no access.
- Admin identity check must be based on a trusted source (e.g. `profiles.role` checked via a `security definer` helper function with a fixed `search_path`), **never** on `user_metadata` (which users can edit).
- Avoid recursive RLS (policies on `profiles` that query `profiles` directly). Use a helper function.
- Include test queries that prove each policy works and each restriction holds.

---

## 6. Admin Account (Secure Initialization)

Explain and propose one method. Requirements:

- There is no public path to become admin. No signup flag, no query param, no metadata field.
- Admin is created by the project owner via a one-time, manual step, for example:
  1. Create the user in the Supabase dashboard (or sign up normally).
  2. Promote it with a documented, one-time SQL statement run in the Supabase SQL editor.
- Enforce "only one admin" with a partial unique index on `role = 'admin'`.
- The admin's email must be verified.
- No admin credentials or emails hardcoded in committed code.
- Document how to rotate/recover the admin account.
- Recommend enabling MFA on the admin account.

---

## 7. Server-Side Security Requirements

- Use `getUser()` (server-verified) for authorization decisions. **Do not trust `getSession()` or cookie contents alone on the server.**
- Never trust client-sent role or approval status.
- Never expose the service-role key to the client. No `NEXT_PUBLIC_` prefix. Server-only module with `import "server-only"`.
- Prefer the normal authenticated client plus RLS. Use the service-role client only where truly needed, and justify each use.
- Approve/reject runs as a server action or route handler that:
  1. Verifies a valid session.
  2. Verifies the caller is the admin from the database (not from the token or client).
  3. Validates input with Zod (UUID, allowed action).
  4. Confirms the target is an `instructor` and currently `pending_approval`.
  5. Confirms the target's email is verified before approval.
  6. Updates status and sets `reviewed_by` / `reviewed_at`.
  7. Returns a safe, generic error on failure.
- **Defense in depth:** middleware/proxy gives fast redirects, but every protected page, server action, and API handler **re-checks authorization itself**.
- Auth callback: validate any `next`/redirect parameter against an allowlist of internal paths (prevent open redirects).
- Use secure, httpOnly cookie sessions appropriate for the installed Next.js and Supabase versions.
- Login errors must be generic ("Invalid email or password"). Avoid account enumeration where Supabase settings allow.
- Recommend rate limiting / CAPTCHA options for register and login (Supabase built-in limits at minimum). Propose, do not over-build.
- Handle resend-verification with a cooldown message.
- Include a sign-out that fully clears the session.

---

## 8. Feature Requirements

### 8.1 Registration (`/register`)

Fields: Full Name, Email, Password, Confirm Password.

- Zod validation, with the same schema usable on client and server:
  - Full name: trimmed, 2–100 characters
  - Email: valid format, normalized to lowercase
  - Password: minimum 8 characters (propose a stronger rule), must match confirmation
- Server-side re-validation (client validation is only UX).
- Create the account through Supabase Auth with email confirmation required.
- After submit: show a "check your email" success state. Do not log the user into the LMS.
- Public users cannot choose or influence the role.

### 8.2 Login (`/login`)

- Email + password.
- After login, route by state per the table in Section 3.
- Link to register.

### 8.3 Email verification

- Supabase email link → callback route that exchanges the code for a session securely.
- Expired/invalid link shows a clear error with a resend option.
- Verification does not approve the account.

### 8.4 Pending Approval (`/pending-approval`)

- Shown to verified instructors with `pending_approval`.
- Shows a clear message and a logout button.
- Approved users who visit it are redirected to `/instructor`; rejected users to the rejected notice.

### 8.5 Admin Dashboard (`/admin`, `/admin/teachers`)

- Admin only.
- `/admin`: simple overview with counts (pending / approved / rejected).
- `/admin/teachers`: table of all instructors showing name, email, email-verified indicator, registration date, status.
- Filter by status: All, Pending, Approved, Rejected.
- Search by name or email (small, optional nicety).
- Approve and Reject actions on pending registrations, each behind a **confirmation dialog** naming the teacher.
- Optional rejection reason field in the reject dialog (confirm in Stage A).
- Disable approval for unverified emails and show why.
- Loading, empty, and error states. Success/error toasts.
- Table adapts to mobile (card layout or horizontal scroll).

### 8.6 Instructor Dashboard (`/instructor`)

Placeholder only:

- Full name
- Email
- Account status
- Logout button

Only approved, email-verified instructors can reach it. Do not build courses, sections, activities, submissions, or grading.

---

## 9. UI Requirements

- shadcn/ui components and Tailwind CSS.
- Responsive: desktop, tablet, mobile.
- Clean, modern, professional.
- Include: loading states, inline form validation messages, success/error toasts, confirmation dialogs, empty states.
- Accessible forms (labels, focus states, `aria-*` for errors, keyboard-operable dialogs).
- Password fields with show/hide toggle.
- Disable submit buttons while pending to prevent double submission.

Pages:

- `/login`
- `/register`
- `/pending-approval`
- `/admin`
- `/admin/teachers`
- `/instructor`

(Additional small pages needed for the flow, such as a rejected notice, verify-email notice, or auth callback route, are allowed. List them in Stage A.)

---

## 10. Scope Restriction

Do NOT implement:

- School management
- Head accounts
- Student accounts
- Courses or subjects
- Sections
- Activities
- Rubrics
- Student submissions
- Grading
- Document requests

Design tables and code so these can be added later, but do not build them now.

---

## 11. Deliverables After Implementation

1. Explanation of all database changes.
2. SQL migrations as files (do not apply to production without my approval).
3. Step-by-step instructions to initialize the Admin account securely.
4. Complete list of environment variables (marking which are server-only), plus required Supabase dashboard settings (email confirmation on, Site URL, redirect URLs, SMTP notes).
5. Testing instructions covering:
   - Registration (valid and invalid inputs)
   - Email verification (valid, expired, resend)
   - Login before verification, after verification but pending, after approval, after rejection
   - Admin approval and rejection
   - Admin-only access
6. A security verification report proving, with evidence:
   - Unapproved instructors cannot access `/instructor` or protected data.
   - Rejected instructors cannot access the LMS.
   - Unverified emails cannot reach protected pages and cannot be approved.
   - An instructor cannot change their own role or status (direct API/SQL attempt fails).
   - An instructor cannot read another instructor's profile.
   - A non-admin cannot call approve/reject.
   - Signup cannot create an admin (including tampered metadata).
   - Service-role key is absent from the client bundle.
7. Known limitations and recommended follow-ups for later phases.

---

## 12. Definition of Done

- [ ] All six required pages work and are responsive.
- [ ] The workflow behaves exactly as specified, with verification and approval kept separate.
- [ ] RLS is enabled and tested on all new tables.
- [ ] Authorization is enforced server-side on every protected page and operation, not only by middleware.
- [ ] Only one admin can exist, and it can't be self-assigned.
- [ ] Type checks, lint, and build pass.
- [ ] Migrations, env var list, and test instructions delivered.
- [ ] Security verification report delivered and reviewed.

**Reminder: Stop after each stage and wait for approval.**
