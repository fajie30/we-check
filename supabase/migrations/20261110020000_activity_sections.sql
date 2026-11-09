-- Reusable activities: an activity belongs to a COURSE and is linked to any number of that course's
-- sections through public.activity_sections. Existing activities keep one link each (their old section).
-- Editing an activity shared by several sections forks it for the editing section (fork_activity).
-- Removing the last link deletes the activity.

-- 1. activities become course-owned -------------------------------------------------------------
alter table public.activities add column course_id uuid references public.courses (id) on delete cascade;
update public.activities a set course_id = s.course_id from public.sections s where s.id = a.section_id;
alter table public.activities alter column course_id set not null;
create index activities_course_idx on public.activities (course_id, created_at desc);

-- 2. links ----------------------------------------------------------------------------------------
create table public.activity_sections (
  activity_id uuid not null references public.activities (id) on delete cascade,
  section_id  uuid not null references public.sections (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (activity_id, section_id)
);
create index activity_sections_section_idx on public.activity_sections (section_id, created_at desc);

insert into public.activity_sections (activity_id, section_id, created_at)
select id, section_id, created_at from public.activities;

-- 3. drop the old section-based policies / guard, then the column ------------------------------------
drop policy "read activities of manageable sections" on public.activities;
drop policy "add activities to manageable sections" on public.activities;
drop policy "edit activities of manageable sections" on public.activities;
drop policy "delete activities of manageable sections" on public.activities;
drop trigger activities_guard on public.activities;
drop function public.activities_before_write();
alter table public.activities drop column section_id;

-- 4. guards ---------------------------------------------------------------------------------------
create function public.activities_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.course_id is distinct from old.course_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    if (select count(*) from public.activities where course_id = new.course_id) >= 500 then
      raise exception 'Too many activities' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger activities_guard
  before insert or update on public.activities
  for each row execute function public.activities_before_write();

-- A link may only join an activity to a section of the SAME course.
create function public.activity_sections_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.sections s
    join public.activities a on a.course_id = s.course_id
    where s.id = new.section_id and a.id = new.activity_id
  ) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger activity_sections_guard
  before insert on public.activity_sections
  for each row execute function public.activity_sections_before_insert();

-- Last link removed -> the activity is deleted.
create function public.activity_sections_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.activity_sections where activity_id = old.activity_id) then
    delete from public.activities where id = old.activity_id;
  end if;
  return null;
end;
$$;
create trigger activity_sections_orphans
  after delete on public.activity_sections
  for each row execute function public.activity_sections_after_delete();

-- 5. RLS -------------------------------------------------------------------------------------------
revoke all on public.activity_sections from anon, authenticated;
grant select, insert, delete on public.activity_sections to authenticated;
alter table public.activity_sections enable row level security;

create policy "read activities of manageable courses"
  on public.activities for select to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_course(course_id)));
create policy "add activities to manageable courses"
  on public.activities for insert to authenticated
  with check ((select public.has_permission('activities')) and (select public.can_manage_course(course_id)));
create policy "edit activities of manageable courses"
  on public.activities for update to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_course(course_id)))
  with check ((select public.has_permission('activities')) and (select public.can_manage_course(course_id)));
create policy "delete activities of manageable courses"
  on public.activities for delete to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_course(course_id)));

create policy "read links of manageable sections"
  on public.activity_sections for select to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));
create policy "add links to manageable sections"
  on public.activity_sections for insert to authenticated
  with check ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));
create policy "remove links from manageable sections"
  on public.activity_sections for delete to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));

-- 6. edit from one section: update in place if only that section uses it, otherwise fork ------------
create function public.fork_activity(
  p_activity uuid, p_section uuid,
  p_title text, p_problem text, p_file_url text, p_total numeric, p_rubric jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_course uuid;
  v_links  int;
  v_new    uuid;
begin
  if not exists (
    select 1 from public.activity_sections where activity_id = p_activity and section_id = p_section
  ) then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  select course_id into v_course from public.activities where id = p_activity;
  if v_course is null then
    raise exception 'Operation not permitted' using errcode = '42501';
  end if;

  select count(*) into v_links from public.activity_sections where activity_id = p_activity;

  if v_links <= 1 then
    update public.activities
       set title = p_title, problem = p_problem, file_url = p_file_url, total_score = p_total, rubric = p_rubric
     where id = p_activity;
    if not found then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    return p_activity;
  end if;

  insert into public.activities (course_id, title, problem, file_url, total_score, rubric)
  values (v_course, p_title, p_problem, p_file_url, p_total, p_rubric)
  returning id into v_new;
  insert into public.activity_sections (activity_id, section_id) values (v_new, p_section);
  delete from public.activity_sections where activity_id = p_activity and section_id = p_section;
  return v_new;
end;
$$;
revoke all on function public.fork_activity(uuid, uuid, text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.fork_activity(uuid, uuid, text, text, text, numeric, jsonb) to authenticated;
