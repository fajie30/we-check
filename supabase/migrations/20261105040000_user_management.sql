-- Admin user management: add (invite), edit, deactivate/reactivate.
-- ADDITIVE: new columns, new functions, new table, one trigger. Two existing functions are
-- replaced with the SAME signature (protect_profile_columns, my_permissions).

alter table public.profiles
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete set null;

create table public.user_audit_log (
  id          bigint generated always as identity primary key,
  action      text not null check (action in ('create', 'edit', 'deactivate', 'reactivate', 'reset_link')),
  user_id     uuid references public.profiles (id) on delete set null,
  detail      jsonb not null default '{}'::jsonb,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);

revoke all on public.user_audit_log from anon, authenticated;
grant select on public.user_audit_log to authenticated;
alter table public.user_audit_log enable row level security;
create policy "admin can read user audit log"
  on public.user_audit_log for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Column protection now also covers the deactivation columns.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id               is distinct from old.id
       or new.email            is distinct from old.email
       or new.role             is distinct from old.role
       or new.approval_status  is distinct from old.approval_status
       or new.reviewed_by      is distinct from old.reviewed_by
       or new.reviewed_at      is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.created_at       is distinct from old.created_at
       or new.deactivated_at   is distinct from old.deactivated_at
       or new.deactivated_by   is distinct from old.deactivated_by then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- A deactivated user has no permissions, whatever their role.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission_key order by rp.permission_key), array[]::text[])
  from public.profiles p
  join public.role_permissions rp on rp.role = p.role
  where p.id = (select auth.uid())
    and p.deactivated_at is null
    and (p.role = 'admin' or p.approval_status = 'approved');
$$;

-- Keep profiles.email in step when the Auth email changes (admin edits an email).
create function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------

-- Called right after the Auth user was created by the admin (invite). Only works on a
-- profile created in the last 5 minutes, so it cannot be used to approve existing users.
create function public.admin_prepare_user(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_user is null or p_role is null or p_role = 'admin'
     or not exists (select 1 from public.roles where key = p_role) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role,
      approval_status = 'approved',
      reviewed_by = v_caller,
      reviewed_at = now()
  where id = p_user
    and role = 'instructor'
    and approval_status = 'pending_approval'
    and created_at > now() - interval '5 minutes';
  if not found then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  insert into public.approval_audit_log (profile_id, decision, reason, decided_by)
  values (p_user, 'approved', 'Created by admin', v_caller);
  insert into public.user_audit_log (action, user_id, detail, changed_by)
  values ('create', p_user, jsonb_build_object('role', p_role), v_caller);
end;
$$;

create function public.admin_update_user(p_user uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_name text := left(btrim(regexp_replace(coalesce(p_full_name, ''), '[[:cntrl:]]', '', 'g')), 100);
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_user is null or char_length(v_name) < 2 then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.profiles set full_name = v_name where id = p_user and role <> 'admin';
  if not found then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  insert into public.user_audit_log (action, user_id, detail, changed_by)
  values ('edit', p_user, jsonb_build_object('full_name', v_name), v_caller);
end;
$$;

create function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_user is null or p_active is null or p_user = v_caller then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.profiles
  set deactivated_at = case when p_active then null else now() end,
      deactivated_by = case when p_active then null else v_caller end
  where id = p_user and role <> 'admin';
  if not found then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  insert into public.user_audit_log (action, user_id, changed_by)
  values (case when p_active then 'reactivate' else 'deactivate' end, p_user, v_caller);
end;
$$;

-- For admin actions that happen in Auth (email change, reset link) so they are still logged.
create function public.admin_log_user_event(p_user uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_action not in ('edit', 'reset_link') or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  insert into public.user_audit_log (action, user_id, detail, changed_by)
  values (p_action, p_user, coalesce(p_detail, '{}'::jsonb), v_caller);
end;
$$;

revoke all on function public.admin_prepare_user(uuid, text)               from public, anon;
revoke all on function public.admin_update_user(uuid, text)                from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean)         from public, anon;
revoke all on function public.admin_log_user_event(uuid, text, jsonb)      from public, anon;
grant execute on function public.admin_prepare_user(uuid, text)            to authenticated;
grant execute on function public.admin_update_user(uuid, text)             to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean)      to authenticated;
grant execute on function public.admin_log_user_event(uuid, text, jsonb)   to authenticated;
