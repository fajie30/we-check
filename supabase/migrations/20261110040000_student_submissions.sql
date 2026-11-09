-- Student work per activity: one Google Drive link per (activity, student) plus the teacher's check
-- (score, rubric snapshot, remarks). No files are stored, only the link.
-- Scores belong to the STUDENT RECORD (one per course), so a score never leaks into another course.
-- Once any student of a section has a saved check on an activity, that activity can't be edited.

create table public.student_submissions (
  activity_id uuid not null references public.activities (id) on delete cascade,
  student_id  uuid not null references public.section_students (id) on delete cascade,
  link_url    text check (link_url is null or char_length(link_url) <= 500),
  checked_at  timestamptz,
  total_score numeric(7,2) check (total_score is null or total_score >= 0),
  selections  jsonb check (selections is null or jsonb_typeof(selections) = 'array'),
  remarks     text check (remarks is null or char_length(remarks) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (activity_id, student_id),
  -- "checked" and "has a score" are the same fact
  constraint submissions_checked_has_score check ((checked_at is null) = (total_score is null))
);
create index student_submissions_student_idx on public.student_submissions (student_id);

-- An activity and a student must belong to the same course.
create function public.student_submissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.student_id is distinct from old.student_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT' or new.activity_id is distinct from old.activity_id then
    if not exists (
      select 1 from public.activities a
      join public.section_students s on s.course_id = a.course_id
      where a.id = new.activity_id and s.id = new.student_id
    ) then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger student_submissions_guard
  before insert or update on public.student_submissions
  for each row execute function public.student_submissions_guard();

create function public.can_manage_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.section_students s
    where s.id = p_student and (select public.can_manage_section(s.section_id))
  );
$$;
revoke all on function public.can_manage_student(uuid) from public, anon;
grant execute on function public.can_manage_student(uuid) to authenticated;

revoke all on public.student_submissions from anon, authenticated;
grant select, insert, update, delete on public.student_submissions to authenticated;
alter table public.student_submissions enable row level security;

create policy "read submissions of manageable students"
  on public.student_submissions for select to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_student(student_id)));
create policy "add submissions for manageable students"
  on public.student_submissions for insert to authenticated
  with check ((select public.has_permission('activities')) and (select public.can_manage_student(student_id)));
create policy "edit submissions of manageable students"
  on public.student_submissions for update to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_student(student_id)))
  with check ((select public.has_permission('activities')) and (select public.can_manage_student(student_id)));
create policy "delete submissions of manageable students"
  on public.student_submissions for delete to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_student(student_id)));

-- Lock: an activity with any saved check can't have its content changed (55006 = object in use).
create or replace function public.activities_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.course_id is distinct from old.course_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    if (new.title, new.problem, new.file_url, new.total_score, new.rubric)
         is distinct from (old.title, old.problem, old.file_url, old.total_score, old.rubric)
       and exists (select 1 from public.student_submissions where activity_id = old.id and checked_at is not null) then
      raise exception 'Activity has checked students' using errcode = '55006';
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

-- Edit from one section: blocked if THIS section's students are already checked; a shared activity
-- forks for the section and the section's students' links move to the copy.
create or replace function public.fork_activity(
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

  if exists (
    select 1 from public.student_submissions ss
    join public.section_students st on st.id = ss.student_id
    where ss.activity_id = p_activity and st.section_id = p_section and ss.checked_at is not null
  ) then
    raise exception 'Activity has checked students' using errcode = '55006';
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

  update public.student_submissions ss
     set activity_id = v_new
    from public.section_students st
   where ss.activity_id = p_activity and st.id = ss.student_id and st.section_id = p_section;

  return v_new;
end;
$$;
