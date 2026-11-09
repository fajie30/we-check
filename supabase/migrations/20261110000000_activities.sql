-- Activities: a task (title + problem statement) that belongs to one section of a course.
-- Access mirrors sections: the role needs the 'activities' permission AND must own the course (or be admin).
-- ADDITIVE: new table, helper function, policies; flips the 'activities' permission out of "coming soon".

create table public.activities (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  title      text not null check (char_length(title) between 2 and 150),
  problem    text not null check (char_length(problem) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_section_idx on public.activities (section_id, created_at desc);

create function public.activities_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.section_id is distinct from old.section_id then
      raise exception 'Operation not permitted' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    if (select count(*) from public.activities where section_id = new.section_id) >= 200 then
      raise exception 'Too many activities' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger activities_guard
  before insert or update on public.activities
  for each row execute function public.activities_before_write();

create function public.can_manage_section(p_section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sections s
    join public.courses c on c.id = s.course_id
    where s.id = p_section
      and (c.owner_id = (select auth.uid()) or (select public.is_admin()))
  );
$$;
revoke all on function public.can_manage_section(uuid) from public, anon;
grant execute on function public.can_manage_section(uuid) to authenticated;

revoke all on public.activities from anon, authenticated;
grant select, insert, update, delete on public.activities to authenticated;
alter table public.activities enable row level security;

create policy "read activities of manageable sections"
  on public.activities for select to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));
create policy "add activities to manageable sections"
  on public.activities for insert to authenticated
  with check ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));
create policy "edit activities of manageable sections"
  on public.activities for update to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)))
  with check ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));
create policy "delete activities of manageable sections"
  on public.activities for delete to authenticated
  using ((select public.has_permission('activities')) and (select public.can_manage_section(section_id)));

update public.permissions
set placeholder = false, description = 'Create and manage the activities of a section.'
where key = 'activities';
