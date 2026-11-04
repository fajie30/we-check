-- Dynamic roles: roles become rows instead of hardcoded checks.
-- 'admin' and 'instructor' are system roles (cannot be deleted; admin cannot be assigned).
-- Custom roles are created by the admin and get permissions only through the matrix.
-- System permissions (admin_only) can never be granted to a custom role.

create table public.roles (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text not null check (char_length(label) between 2 and 40),
  description text check (description is null or char_length(description) <= 200),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into public.roles (key, label, description, is_system) values
  ('admin',      'Admin',   'Full control of WeCheck.',                         true),
  ('instructor', 'Teacher', 'Teachers who run classes once approved.',          true);

-- Hardcoded checks -> foreign keys to the roles table.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles
  add constraint profiles_role_fkey foreign key (role) references public.roles (key);

alter table public.role_permissions drop constraint role_permissions_role_check;
alter table public.role_permissions
  add constraint role_permissions_role_fkey
  foreign key (role) references public.roles (key) on delete cascade;

-- permissions.roles: NULL now means "any non-locked role".
alter table public.permissions drop constraint permissions_roles_check;
alter table public.permissions alter column roles drop not null;
update public.permissions set roles = null where key in ('courses', 'sections', 'activities', 'grading');

-- Applicability is now "roles" (NULL = any role) minus "excluded_roles".
alter table public.permissions add column excluded_roles text[] not null default '{}';

-- The teacher dashboard can be granted to any non-admin role (e.g. Head = Teacher + more).
update public.permissions set roles = null, excluded_roles = array['admin'] where key = 'instructor_dashboard';

-- Placeholder for extra head functions. Not built yet.
insert into public.permissions (key, label, description, roles, admin_only, placeholder, sort_order) values
  ('head_tools', 'Head tools', 'Oversight tools for heads (teachers, sections, reports). Not built yet.', null, false, true, 35);
insert into public.role_permissions (role, permission_key) values ('admin', 'head_tools');

create table public.role_audit_log (
  id          bigint generated always as identity primary key,
  action      text not null check (action in ('create', 'rename', 'delete', 'assign')),
  role_key    text not null,
  detail      jsonb not null default '{}'::jsonb,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Role CRUD (admin only)
-- ---------------------------------------------------------------------------
-- p_copy_from: optional existing non-admin role whose (non-locked) permissions are copied,
-- e.g. create "Head" copying "instructor" to get Teacher + extras.
create function public.admin_create_role(
  p_key text, p_label text, p_description text default null, p_copy_from text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_label text := btrim(p_label);
  v_desc text := nullif(btrim(p_description), '');
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,30}$'
     or char_length(coalesce(v_label, '')) not between 2 and 40
     or (v_desc is not null and char_length(v_desc) > 200) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if (select count(*) from public.roles) >= 20 then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if p_copy_from is not null
     and (p_copy_from = 'admin' or not exists (select 1 from public.roles where key = p_copy_from)) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  insert into public.roles (key, label, description, is_system) values (p_key, v_label, v_desc, false);

  if p_copy_from is not null then
    insert into public.role_permissions (role, permission_key)
    select p_key, rp.permission_key
    from public.role_permissions rp
    join public.permissions pm on pm.key = rp.permission_key
    where rp.role = p_copy_from
      and not pm.admin_only
      and (pm.roles is null or p_key = any (pm.roles))
      and not (p_key = any (pm.excluded_roles));
  end if;

  insert into public.role_audit_log (action, role_key, detail, changed_by)
  values ('create', p_key, jsonb_build_object('label', v_label, 'copied_from', p_copy_from), v_caller);
end;
$$;

create function public.admin_update_role(p_key text, p_label text, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_label text := btrim(p_label);
  v_desc text := nullif(btrim(p_description), '');
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_key is null or p_key = 'admin'
     or char_length(coalesce(v_label, '')) not between 2 and 40
     or (v_desc is not null and char_length(v_desc) > 200) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.roles set label = v_label, description = v_desc where key = p_key;
  if not found then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  insert into public.role_audit_log (action, role_key, detail, changed_by)
  values ('rename', p_key, jsonb_build_object('label', v_label), v_caller);
end;
$$;

create function public.admin_delete_role(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_system boolean;
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  select is_system into v_system from public.roles where key = p_key;
  if not found or v_system then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where role = p_key) then
    -- 23503 lets the app say "reassign its users first".
    raise exception 'Role is in use' using errcode = '23503';
  end if;

  delete from public.roles where key = p_key;  -- role_permissions rows cascade
  insert into public.role_audit_log (action, role_key, changed_by) values ('delete', p_key, v_caller);
end;
$$;

-- Assign a role to a user. Never changes approval_status and never makes an admin.
create function public.admin_set_user_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_old text;
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  if p_user is null or p_role is null or p_role = 'admin' or p_user = v_caller
     or not exists (select 1 from public.roles where key = p_role) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  select role into v_old from public.profiles where id = p_user for update;
  if not found or v_old = 'admin' then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  update public.profiles set role = p_role where id = p_user;
  insert into public.role_audit_log (action, role_key, detail, changed_by)
  values ('assign', p_role, jsonb_build_object('user', p_user, 'from', v_old), v_caller);
end;
$$;

-- ---------------------------------------------------------------------------
-- Matrix writer: now supports any role, but still never locked cells.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role_permission(p_role text, p_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles text[];
  v_excluded text[];
  v_locked boolean;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  select roles, admin_only, excluded_roles into v_roles, v_locked, v_excluded
  from public.permissions where key = p_key;
  if not found or p_role is null or p_granted is null or v_locked
     or not exists (select 1 from public.roles where key = p_role)
     or (v_roles is not null and not (p_role = any (v_roles)))
     or p_role = any (v_excluded) then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  if p_granted then
    insert into public.role_permissions (role, permission_key)
    values (p_role, p_key) on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role and permission_key = p_key;
  end if;

  insert into public.role_permission_changes (role, permission_key, granted, changed_by)
  values (p_role, p_key, p_granted, v_caller);
end;
$$;

-- ---------------------------------------------------------------------------
-- Approvals and the user list now cover every non-admin role.
-- ---------------------------------------------------------------------------
create or replace function public.review_instructor(
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
  where id = p_target and role <> 'admin'
  for update;

  if not found or v_status <> 'pending_approval' then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

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

-- ADDITIVE: the old admin_list_instructors() is left untouched so the currently
-- deployed app keeps working. A later cleanup migration drops it once the new
-- app version is live.
create function public.admin_list_users()
returns table (
  id               uuid,
  full_name        text,
  email            text,
  role             text,
  role_label       text,
  approval_status  text,
  rejection_reason text,
  created_at       timestamptz,
  reviewed_at      timestamptz,
  email_verified   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, p.email, p.role, r.label, p.approval_status, p.rejection_reason,
         p.created_at, p.reviewed_at, (u.email_confirmed_at is not null)
  from public.profiles p
  join public.roles r on r.key = p.role
  join auth.users u on u.id = p.id
  where p.role <> 'admin'
  order by p.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the caller's role may open (for the /home page).
-- ---------------------------------------------------------------------------
create function public.my_modules()
returns table (key text, label text, description text, placeholder boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.key, p.label, p.description, p.placeholder
  from public.permissions p
  where p.key = any (public.my_permissions())
  order by p.sort_order;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on function public.admin_create_role(text, text, text, text) from public, anon;
revoke all on function public.admin_update_role(text, text, text)  from public, anon;
revoke all on function public.admin_delete_role(text)              from public, anon;
revoke all on function public.admin_set_user_role(uuid, text)      from public, anon;
revoke all on function public.admin_list_users()                   from public, anon;
revoke all on function public.my_modules()                         from public, anon;
grant execute on function public.admin_create_role(text, text, text, text) to authenticated;
grant execute on function public.admin_update_role(text, text, text) to authenticated;
grant execute on function public.admin_delete_role(text)             to authenticated;
grant execute on function public.admin_set_user_role(uuid, text)     to authenticated;
grant execute on function public.admin_list_users()                  to authenticated;
grant execute on function public.my_modules()                        to authenticated;

revoke all on public.roles          from anon, authenticated;
revoke all on public.role_audit_log from anon, authenticated;
grant select on public.roles          to authenticated;
grant select on public.role_audit_log to authenticated;

alter table public.roles          enable row level security;
alter table public.role_audit_log enable row level security;

-- Role names are not sensitive (shown on every profile); only the admin can write (via functions).
create policy "signed-in users can read roles"
  on public.roles for select to authenticated using (true);
create policy "admin can read role audit log"
  on public.role_audit_log for select to authenticated using ((select public.is_admin()));
