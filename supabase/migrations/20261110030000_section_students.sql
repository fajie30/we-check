-- Section rosters. A student (ID number + full name) is a record of one section.
-- The ID number is unique within a COURSE: a student cannot be in two sections of the same course,
-- but can be in sections of other courses. Access: 'sections' permission + course ownership (or admin).
-- ADDITIVE: new table, guard trigger, RLS.

create table public.section_students (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  id_number  text not null check (char_length(id_number) between 1 and 30 and id_number = btrim(id_number)),
  full_name  text not null check (char_length(full_name) between 2 and 150 and full_name = btrim(full_name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Same ID (ignoring case) cannot appear twice in one course.
create unique index section_students_course_id_idx on public.section_students (course_id, lower(id_number));
create index section_students_section_idx on public.section_students (section_id, full_name);

-- course_id is always derived from the section, never trusted from the client.
create function public.section_students_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.section_id is distinct from old.section_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    new.course_id := old.course_id;
    new.updated_at := now();
  else
    select s.course_id into new.course_id from public.sections s where s.id = new.section_id;
    if new.course_id is null then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    if (select count(*) from public.section_students where section_id = new.section_id) >= 500 then
      raise exception 'Too many students' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger section_students_guard
  before insert or update on public.section_students
  for each row execute function public.section_students_before_write();

revoke all on public.section_students from anon, authenticated;
grant select, insert, update, delete on public.section_students to authenticated;
alter table public.section_students enable row level security;

create policy "read students of manageable sections"
  on public.section_students for select to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_section(section_id)));
create policy "add students to manageable sections"
  on public.section_students for insert to authenticated
  with check ((select public.has_permission('sections')) and (select public.can_manage_section(section_id)));
create policy "edit students of manageable sections"
  on public.section_students for update to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_section(section_id)))
  with check ((select public.has_permission('sections')) and (select public.can_manage_section(section_id)));
create policy "remove students from manageable sections"
  on public.section_students for delete to authenticated
  using ((select public.has_permission('sections')) and (select public.can_manage_section(section_id)));
