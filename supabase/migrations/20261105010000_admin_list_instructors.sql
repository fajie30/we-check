-- Admin-only listing of instructors, including email verification state.
-- auth.users is not readable through the API, so a SECURITY DEFINER function
-- exposes just email_confirmed_at (as a boolean) to the admin.

create function public.admin_list_instructors()
returns table (
  id               uuid,
  full_name        text,
  email            text,
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
  select p.id, p.full_name, p.email, p.approval_status, p.rejection_reason,
         p.created_at, p.reviewed_at, (u.email_confirmed_at is not null)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'instructor'
  order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_instructors() from public, anon;
grant execute on function public.admin_list_instructors() to authenticated;
