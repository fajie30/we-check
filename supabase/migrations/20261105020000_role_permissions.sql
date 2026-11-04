-- Role management: a permission catalog + a per-role grant matrix.
-- Roles stay fixed (admin, instructor). The admin edits which modules each role may use.
-- System permissions (admin_only) are locked: always held by admin, never by instructors.

create table public.permissions (
  key         text primary key,
  label       text not null,
  description text not null,
  roles       text[] not null check (roles <@ array['admin', 'instructor']),  -- roles that may hold it
  admin_only  boolean not null default false,                                   -- locked system permission
  placeholder boolean not null default false,                                   -- module not built yet
  sort_order  int not null
);

create table public.role_permissions (
  role           text not null check (role in ('admin', 'instructor')),
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role, permission_key)
);

create table public.role_permission_changes (
  id             bigint generated always as identity primary key,
  role           text not null,
  permission_key text not null,
  granted        boolean not null,
  changed_by     uuid references public.profiles (id) on delete set null,
  changed_at     timestamptz not null default now()
);

insert into public.permissions (key, label, description, roles, admin_only, placeholder, sort_order) values
  ('teacher_approvals',   'Teacher approvals',   'Review, approve and reject teacher registrations.',            array['admin'],               true,  false, 10),
  ('role_management',     'Role management',     'Edit which modules each role can access.',                      array['admin'],               true,  false, 20),
  ('instructor_dashboard','Instructor dashboard','Open the teacher dashboard after approval.',                    array['instructor'],          false, false, 30),
  ('courses',             'Courses',             'Create and manage courses. Not built yet.',                     array['admin', 'instructor'], false, true,  40),
  ('sections',            'Sections',            'Manage class sections. Not built yet.',                         array['admin', 'instructor'], false, true,  50),
  ('activities',          'Activities',          'Create activities and rubrics. Not built yet.',                 array['admin', 'instructor'], false, true,  60),
  ('grading',             'Grading',             'Grade student submissions. Not built yet.',                     array['admin', 'instructor'], false, true,  70);

insert into public.role_permissions (role, permission_key) values
  ('admin', 'teacher_approvals'),
  ('admin', 'role_management'),
  ('admin', 'courses'),
  ('admin', 'sections'),
  ('admin', 'activities'),
  ('admin', 'grading'),
  ('instructor', 'instructor_dashboard');

-- ---------------------------------------------------------------------------
-- The caller's effective permissions. Instructors only count once approved.
-- ---------------------------------------------------------------------------
create function public.my_permissions()
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
    and (p.role = 'admin' or p.approval_status = 'approved');
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- For use in future RLS policies: using ((select public.has_permission('courses')))
create function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key = any (public.my_permissions());
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin-only write path for the matrix.
-- ---------------------------------------------------------------------------
create function public.admin_set_role_permission(p_role text, p_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles text[];
  v_locked boolean;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not (select public.is_admin()) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  select roles, admin_only into v_roles, v_locked from public.permissions where key = p_key;
  if not found or p_role is null or p_granted is null
     or not (p_role = any (v_roles)) or v_locked then
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
revoke all on function public.admin_set_role_permission(text, text, boolean) from public, anon;
grant execute on function public.admin_set_role_permission(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: the admin reads the matrix; nobody writes directly.
-- ---------------------------------------------------------------------------
revoke all on public.permissions             from anon, authenticated;
revoke all on public.role_permissions        from anon, authenticated;
revoke all on public.role_permission_changes from anon, authenticated;
grant select on public.permissions             to authenticated;
grant select on public.role_permissions        to authenticated;
grant select on public.role_permission_changes to authenticated;

alter table public.permissions             enable row level security;
alter table public.role_permissions        enable row level security;
alter table public.role_permission_changes enable row level security;

create policy "admin can read permissions"
  on public.permissions for select to authenticated using ((select public.is_admin()));
create policy "admin can read role permissions"
  on public.role_permissions for select to authenticated using ((select public.is_admin()));
create policy "admin can read permission changes"
  on public.role_permission_changes for select to authenticated using ((select public.is_admin()));
