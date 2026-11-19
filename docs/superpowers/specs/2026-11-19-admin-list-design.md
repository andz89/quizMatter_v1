# Admin → Admins (a list of the admins)

## Why

Admins are added by hand in the Supabase SQL editor (`insert into public.admins …`). The super admin wants to see
who is an admin without opening the database.

## Goals

- A view-only page listing every admin: email, display name, Super admin / Admin, whether their two-step login is
  set up, when they joined and last logged in.
- Super admin only (it shows emails; same as Teachers).

## Non-goals

- No adding or removing admins in the app (stays in the SQL editor; the page says how).
- No database change.

## Approaches

1. **Read with the secret key in the page (picked).** `admins` (`user_id`, `is_super`) + `auth.admin.getUserById`
   per admin (a handful) + `user_settings.display_name`. No migration, nothing to apply live.
2. A new `admin_admins()` rpc like `admin_editors`. Needs a migration and the live SQL step for a few rows; not worth it.
3. A filter on Teachers. Teachers lists every account (slow) and mixes in ban buttons; a separate short page is clearer.

## Design

- `src/app/admin/admins/page.tsx` (server component): `getAccount().isSuperAdmin` else `notFound()`; no secret key →
  the same message as Editors. Rows sorted super admin first, then by email. A factor with `status === "verified"`
  means two-step is on.
- `loading.tsx` with `TopLoadingBar` + `Spinner`.
- `AdminMenu`: `{ href: "/admin/admins", label: "Admins", superOnly: true }` in People.
- Notes: a line in `src/app/admin/CLAUDE.md` (menu groups, superOnly list, pages table).
- Design system: the card/pill classes Editors uses.
