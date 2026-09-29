-- The same list as used_photo_srcs(), for the admin page "Photo cleanup" (src/app/admin/cleanup), which
-- shows the files the weekly cleanup will delete. Admins only: anyone else gets an error.
-- "security definer" lets it see every teacher's photos and slides (not just the admin's own), like the
-- cleanup job does. It only returns photo addresses, nothing else.

create function public.admin_used_photo_srcs()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see this.' using errcode = '42501';
  end if;
  return public.used_photo_srcs();
end;
$$;

revoke execute on function public.admin_used_photo_srcs() from public, anon;
grant execute on function public.admin_used_photo_srcs() to authenticated;
