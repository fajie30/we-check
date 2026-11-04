-- Phase 1: profiles, teacher approval, audit log, RLS.
-- Email verification uses auth.users.email_confirmed_at (no duplicate flag);
-- Supabase "Confirm email" must be ON. Verification does not change approval status.
-- NOT applied to any database until reviewed/approved.

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null check (char_length(full_name) between 1 and 100),
  email            text not null,
  role             text not null default 'instructor'
                     check (role in ('admin', 'instructor')),
  approval_status  text not null default 'pending_approval'
                     check (approval_status in ('pending_approval', 'approved', 'rejected')),
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rejection_reason_only_when_rejected
    check (rejection_reason is null or approval_status = 'rejected')
);

-- Exactly one admin, ever.
create unique index profiles_single_admin on public.profiles (role) where role = 'admin';
create index profiles_status_created_idx on public.profiles (approval_status, created_at desc);

-- ---------------------------------------------------------------------------
-- approval_audit_log (insert-only history of decisions)
-- ---------------------------------------------------------------------------
create table public.approval_audit_log (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  decision    text not null check (decision in ('approved', 'rejected')),
  reason      text check (reason is null or char_length(reason) <= 500),
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz not null default now()
);
create index approval_audit_log_profile_idx on public.approval_audit_log (profile_id);

-- ---------------------------------------------------------------------------
-- Helper: is the caller the admin? (security definer avoids recursive RLS;
-- reads the DB role, never user_metadata)
-- ---------------------------------------------------------------------------
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Signup trigger: always instructor + pending_approval.
-- Only full_name is read from metadata (stripped, trimmed, length-limited).
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := left(
    btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[[:cntrl:]]', '', 'g')),
    100
  );
  if v_name = '' then
    v_name := 'Unnamed teacher';
  end if;

  insert into public.profiles (id, full_name, email, role, approval_status)
  values (new.id, v_name, lower(new.email), 'instructor', 'pending_approval');
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Column protection: API roles can never change protected columns, even if
-- a policy were added later by mistake. Trusted paths (SECURITY DEFINER
-- functions owned by postgres, the SQL editor) run as non-API roles and pass.
-- ---------------------------------------------------------------------------
create function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id              is distinct from old.id
       or new.email           is distinct from old.email
       or new.role            is distinct from old.role
       or new.approval_status is distinct from old.approval_status
       or new.reviewed_by     is distinct from old.reviewed_by
       or new.reviewed_at     is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.created_at      is distinct from old.created_at then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- Approve / reject: the only write path for approval state.
-- Authorization is checked inside the database, not by the caller.
-- ---------------------------------------------------------------------------
create function public.review_instructor(
  p_target   uuid,
  p_decision text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_status text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if v_reason is not null and (p_decision <> 'reject' or char_length(v_reason) > 500) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  select approval_status into v_status
  from public.profiles
  where id = p_target and role = 'instructor'
  for update;

  if not found or v_status <> 'pending_approval' then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  -- Approval requires a verified email (auth.users.email_confirmed_at is the
  -- single source of truth). Rejection is allowed regardless.
  if p_decision = 'approve' and not exists (
    select 1 from auth.users where id = p_target and email_confirmed_at is not null
  ) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.profiles
  set approval_status  = case p_decision when 'approve' then 'approved' else 'rejected' end,
      reviewed_by      = v_caller,
      reviewed_at      = now(),
      rejection_reason = v_reason
  where id = p_target;

  insert into public.approval_audit_log (profile_id, decision, reason, decided_by)
  values (p_target,
          case p_decision when 'approve' then 'approved' else 'rejected' end,
          v_reason,
          v_caller);
end;
$$;
revoke all on function public.review_instructor(uuid, text, text) from public, anon;
grant execute on function public.review_instructor(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS. No insert/update/delete policies exist: writes happen only
-- via the signup trigger and review_instructor().
-- ---------------------------------------------------------------------------
revoke all on public.profiles           from anon, authenticated;
revoke all on public.approval_audit_log from anon, authenticated;
grant select on public.profiles           to authenticated;
grant select on public.approval_audit_log to authenticated;

alter table public.profiles           enable row level security;
alter table public.approval_audit_log enable row level security;

create policy "own profile or admin can read"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "admin can read audit log"
  on public.approval_audit_log for select to authenticated
  using ((select public.is_admin()));
