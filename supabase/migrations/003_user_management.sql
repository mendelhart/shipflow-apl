-- =====================================================================
-- 003 — let an admin actually manage users from inside the app
--
-- Migration 002 closed the privilege-escalation hole correctly but left no
-- way through it. Two things blocked an admin:
--
--   1. `grant update (full_name) on profiles to authenticated` — Postgres
--      column privileges are checked before row-level policies and before
--      triggers, so an admin's UPDATE touching is_active was rejected
--      outright. The guard_profile_privileges trigger already contains the
--      correct rule (admins may change role/is_active, nobody else may);
--      it simply never got the chance to run.
--
--   2. `profiles_self_update` restricts every update to id = auth.uid(),
--      so an admin could not write to anyone else's row.
--
-- The result was that activating a new colleague required opening the
-- Supabase dashboard and editing a table by hand. Every new member of staff
-- would have gone through that.
--
-- Safe to run more than once.
-- =====================================================================

-- 1. Widen the column grant. The trigger, not the grant, decides who may
--    change role and is_active.
grant update (full_name, role, is_active) on profiles to authenticated;

-- 2. An admin may write to any profile; everyone else only their own.
--    Column-level enforcement still comes from guard_profile_privileges,
--    so a non-admin updating their own row can still only touch full_name.
drop policy if exists profiles_self_update on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  to authenticated
  using      (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 3. An admin needs to see the list to manage it. profiles_read_self
--    (migration 002) already allows `id = auth.uid() or public.is_admin()`;
--    recreated here so this file stands alone on a fresh database.
drop policy if exists profiles_read_self on profiles;
create policy profiles_read_self on profiles for select
  to authenticated using (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- Guard against locking yourself out.
--
-- With a Users screen it becomes possible to remove your own admin role, or
-- deactivate the last admin, and then have no way back in except the
-- Supabase dashboard — the exact situation this migration exists to end.
-- ---------------------------------------------------------------------
create or replace function guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  remaining int;
begin
  if auth.uid() is null then
    return new;  -- server-side contexts are already privileged
  end if;

  if (old.role = 'admin' and new.role is distinct from 'admin')
     or (old.is_active and not new.is_active and old.role = 'admin') then
    select count(*) into remaining
      from public.profiles
     where role = 'admin' and is_active and id <> old.id;
    if remaining = 0 then
      raise exception 'This is the last active admin. Promote someone else first.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_last_admin on profiles;
create trigger profiles_guard_last_admin before update on profiles
  for each row execute function guard_last_admin();

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
select 'update grants' as check, string_agg(column_name, ', ' order by column_name) as detail
  from information_schema.column_privileges
 where table_name = 'profiles' and privilege_type = 'UPDATE' and grantee = 'authenticated'
union all
select 'profiles policies', string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
  from pg_policies where tablename = 'profiles'
union all
select 'active admins', string_agg(email, ', ')
  from profiles where role = 'admin' and is_active;
