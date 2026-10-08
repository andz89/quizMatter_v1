-- Teacher sign up (docs/superpowers/specs/2026-10-09-teacher-sign-up-design.md): the details a teacher gives when
-- they sign up. Shown on their Account page (they can change them there) and in Admin → Teachers. Empty for
-- teachers added by hand in the Supabase dashboard.
-- The limits are checked with zod first (profileSchema and signUpSchema in src/lib/userSettings.ts).

alter table public.user_settings
  add column first_name text not null default '' check (length(first_name) <= 35),
  add column last_name text not null default '' check (length(last_name) <= 35),
  add column contact_number text not null default '' check (length(contact_number) <= 20),
  add column education_level text not null default ''
    check (education_level in ('', 'bachelor', 'master', 'doctorate', 'other')),
  add column education_field text not null default '' check (length(education_field) <= 100);

-- The sign up page sends the details along with the new account (Supabase keeps them as user metadata). This copies
-- them into the new teacher's settings row the moment the account is made, before they confirm their email (they
-- can't write the row themselves yet: they aren't logged in). A teacher added by hand has no metadata, so their row
-- is empty. Bad values (e.g. sent straight to the Supabase API) break the checks above, and the sign up fails.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field)
  values (
    new.id,
    trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', ''))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
