-- Courses and sections.
-- A course (e.g. "English") belongs to the user who created it and has any number of sections
-- (e.g. A, B, C, D). Teachers manage their own courses; the admin manages all of them.
-- Access is enforced here with RLS and the role-permission matrix ('courses' and 'sections'),
-- not only in the app.
-- ADDITIVE: new tables and functions, plus two permission rows updated (no longer "coming soon").

create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  name        text not null check (char_length(name) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index courses_owner_idx on public.courses (owner_id, created_at desc);

create table public.sections (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now()
);
-- "a" and "A" are the same section within one course.
create unique index sections_course_name_idx on public.sections (course_id, lower(name));
create index sections_course_idx on public.sections (course_id, created_at);

-- ---------------------------------------------------------------------------
-- Guard rails: owner never changes, sane limits.
-- ---------------------------------------------------------------------------
create function public.courses_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    if (select count(*) from public.courses where owner_id = new.owner_id) >= 200 then
      raise exception 'Too many courses' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger courses_guard
  before insert or update on public.courses
  for each row execute function public.courses_before_write();

create function public.sections_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.sections where course_id = new.course_id) >= 50 then
    raise exception 'Too many sections' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger sections_limit
  before insert on public.sections
  for each row execute function public.sections_before_insert();

-- ---------------------------------------------------------------------------
-- Can the caller manage this course? (owner, or the admin.) SECURITY DEFINER so the
-- sections policies do not depend on the caller's own access to the courses table.
-- ---------------------------------------------------------------------------
create function public.can_manage_course(p_course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course
      and (c.owner_id = (select auth.uid()) or (select public.is_admin()))
  );
$$;
revoke all on function public.can_manage_course(uuid) from public, anon;
grant execute on function public.can_manage_course(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Every policy needs the role to hold the permission (deactivated and
-- unapproved users hold none), and then ownership (or admin).
-- ---------------------------------------------------------------------------
revoke all on public.courses  from anon, authenticated;
revoke all on public.sections from anon, authenticated;
grant select, insert, update, delete on public.courses  to authenticated;
grant select, insert, update, delete on public.sections to authenticated;

alter table public.courses  enable row level security;
alter table public.sections enable row level security;

create policy "read own courses (admin: all)"
  on public.courses for select to authenticated
  using ((select public.has_permission('courses'))
         and (owner_id = (select auth.uid()) or (select public.is_admin())));

create policy "create own courses"
  on public.courses for insert to authenticated
  with check ((select public.has_permission('courses')) and owner_id = (select auth.uid()));

create policy "update own courses (admin: all)"
  on public.courses for update to authenticated
  using ((select public.has_permission('courses'))
         and (owner_id = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.has_permission('courses'))
         and (owner_id = (select auth.uid()) or (select public.is_admin())));

create policy "delete own courses (admin: all)"
  on public.courses for delete to authenticated
  using ((select public.has_permission('courses'))
         and (owner_id = (select auth.uid()) or (select public.is_admin())));

create policy "read sections of manageable courses"
  on public.sections for select to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_course(course_id)));

create policy "add sections to manageable courses"
  on public.sections for insert to authenticated
  with check ((select public.has_permission('sections')) and (select public.can_manage_course(course_id)));

create policy "rename sections of manageable courses"
  on public.sections for update to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_course(course_id)))
  with check ((select public.has_permission('sections')) and (select public.can_manage_course(course_id)));

create policy "remove sections of manageable courses"
  on public.sections for delete to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_course(course_id)));

-- These two modules are real now.
update public.permissions
set placeholder = false, description = 'Create and manage your courses.'
where key = 'courses';
update public.permissions
set placeholder = false, description = 'Add, rename and remove the sections (classes) of a course.'
where key = 'sections';
