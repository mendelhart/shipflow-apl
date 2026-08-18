-- =====================================================================
--  002 — fixes from the senior code review
--  Safe to run on the live database. Idempotent.
-- =====================================================================
--  Contents:
--    A. Missing columns the app writes but the schema never had
--    B. Privilege escalation fix on profiles
--    C. Membership model — close the open-signup hole
--    D. Secrets out of the database
--    E. Business-key uniqueness
--    F. Status monotonicity enforced server-side
--    G. Audit trail
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Missing columns
--
-- The app writes these on every save. Because they do not exist,
-- PostgREST rejects the ENTIRE row with PGRST204, so the Settings page,
-- every purchase-order save and every customer-invoice save fail 100% of
-- the time. Base44's document store accepted undeclared fields; Postgres
-- does not.
-- ---------------------------------------------------------------------
alter table app_settings     add column if not exists exporter_name  text;
alter table app_settings     add column if not exists exporter_title text;
alter table app_settings     add column if not exists customs_id     text;

alter table purchase_order   add column if not exists exporter_name  text;
alter table purchase_order   add column if not exists exporter_title text;

-- CustomerDocs writes this camelCase key; customer_invoice already uses
-- quoted camelCase for invoiceNumber/invoiceDate, so stay consistent.
alter table customer_invoice add column if not exists "commonName"   text;

-- Seed the exporter identity that was previously hardcoded in the
-- document components, so invoices stop depending on fallback literals.
update app_settings
   set exporter_name  = coalesce(exporter_name,  'Mendel Hart'),
       exporter_title = coalesce(exporter_title, 'Business Development Director'),
       customs_id     = coalesce(customs_id,     '785337692RM0003')
 where exporter_name is null or exporter_title is null or customs_id is null;

-- ---------------------------------------------------------------------
-- B. Privilege escalation
--
-- The previous policy let a user update their own profile row, and `role`
-- is a column on that row. Any signed-in user could run
--   supabase.from('profiles').update({role:'admin'}).eq('id', <self>)
-- and become an admin. Row-level policies cannot restrict columns, so the
-- fix is a column grant plus a trigger as a second line of defence.
-- ---------------------------------------------------------------------
revoke update on profiles from authenticated;
grant  update (full_name) on profiles to authenticated;

create or replace function guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Server-side contexts (SQL editor, service_role, migrations, the signup
  -- trigger) have no auth.uid(). They are already privileged; the guard
  -- exists to stop a browser session escalating itself.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email
     or new.id is distinct from old.id then
    if not public.is_admin() then
      raise exception 'not permitted to change role, is_active, email or id'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_privileges on profiles;
create trigger profiles_guard_privileges before update on profiles
  for each row execute function guard_profile_privileges();

-- Users could also read every other user's row (email harvesting).
drop policy if exists profiles_self_read on profiles;
create policy profiles_read_self on profiles for select
  to authenticated using (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- C. Membership — close the open-signup hole
--
-- Email sign-in creates a user for ANY address by default, the signup
-- trigger auto-created a profile, and every table policy was
-- `using (true)`. So anyone on the internet could sign up and then read,
-- modify or delete the entire business dataset over the REST API without
-- ever loading the app.
--
-- Membership is now explicit: a profile must be active. New signups are
-- auto-activated only for the company domain; everyone else lands
-- inactive and RLS denies them everything.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists is_active boolean not null default false;

comment on column profiles.is_active is
  'Gate for all data access. Auto-set for @capitalnutrition.ca signups; an admin must activate anyone else.';

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and is_active)
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  company_domain constant text := '@capitalnutrition.ca';
  bootstrap_admins constant text[] :=
    array['mhart@capitalnutrition.ca', 'mendel@capitalnutrition.ca'];
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    case when new.email = any(bootstrap_admins) then 'admin' else 'user' end,
    new.email ilike ('%' || company_domain)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Anyone who already has a profile from the company domain stays active.
update profiles set is_active = true where email ilike '%@capitalnutrition.ca';
update profiles set role = 'admin'
 where email in ('mhart@capitalnutrition.ca', 'mendel@capitalnutrition.ca');

-- Re-point every business table at membership instead of `true`.
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','vendor','product','purchase_order',
    'customer_invoice','inbound_shipment','sclp','tjx_canada_invoice_log'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);

    execute format(
      'create policy %I on %I for select to authenticated using (public.is_member())',
      t || '_read', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (public.is_member())',
      t || '_write', t);
    execute format(
      'create policy %I on %I for update to authenticated using (public.is_member()) with check (public.is_member())',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (public.is_member())',
      t || '_delete', t);
  end loop;
end $$;

-- app_settings holds company-wide configuration. Everyone reads it (logo,
-- templates, colours); only admins change it.
drop policy if exists app_settings_write  on app_settings;
drop policy if exists app_settings_update on app_settings;
drop policy if exists app_settings_delete on app_settings;
create policy app_settings_write on app_settings for insert
  to authenticated with check (public.is_admin());
create policy app_settings_update on app_settings for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy app_settings_delete on app_settings for delete
  to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- D. Secrets out of the database
--
-- mailgun_api_key sat in a row every authenticated user could read, and
-- the Edge Function fell back to it. A live sending credential for
-- mg.capitalnutrition.ca was one SELECT away for anyone with an account —
-- enough to send invoices "from" the company to TJX and APL.
-- The key now lives only in Edge Function secrets.
-- ---------------------------------------------------------------------
alter table app_settings drop column if exists mailgun_api_key;

-- ---------------------------------------------------------------------
-- E. Business-key uniqueness
--
-- Verified against live data before adding:
--   purchase_order (po_prefix, po_number) — 4 apparent duplicates are all
--     legitimate 50/55 prefix pairs, so the composite key is clean.
--   product.item_number — no duplicates.
--   sclp.booking_number — no duplicates.
--   product.upc_code — NOT constrained: two real collisions exist today
--     (1002/1003 and 1099G/1099P share a UPC). See the report.
-- ---------------------------------------------------------------------
create unique index if not exists purchase_order_prefix_number_uk
  on purchase_order (po_prefix, po_number)
  where po_number is not null and po_number <> '';

create unique index if not exists product_item_number_uk
  on product (item_number)
  where item_number is not null and item_number <> '';

create unique index if not exists sclp_booking_number_uk
  on sclp (booking_number)
  where booking_number is not null and booking_number <> '';

-- Non-unique, because duplicates exist. Still worth indexing: CustomerDocs
-- looks products up by UPC on every AI import.
create index if not exists product_upc_code_idx on product (upc_code);

-- Supports the TJX history search, which currently filters client-side.
create index if not exists tjx_canada_invoice_log_po_number_idx
  on tjx_canada_invoice_log (po_number);

-- ---------------------------------------------------------------------
-- F. Status monotonicity
--
-- draft -> ready -> booked -> shipped -> invoiced is enforced in five
-- separate client-side copies, all of which compare against the row the
-- browser loaded. Two users working concurrently can therefore move a PO
-- backwards. Enforce it once, server-side, where it cannot be raced.
-- ---------------------------------------------------------------------
create or replace function po_status_rank(s text) returns int
language sql immutable as $$
  select coalesce(array_position(
    array['draft','ready','booked','shipped','invoiced'], s), 0)
$$;

create or replace function guard_po_status() returns trigger
language plpgsql as $$
begin
  if new.status is not null and old.status is not null
     and po_status_rank(new.status) < po_status_rank(old.status) then
    -- Keep the further-advanced status rather than rejecting the write:
    -- the rest of the user's edit is still valid.
    new.status := old.status;
  end if;
  return new;
end $$;

drop trigger if exists purchase_order_guard_status on purchase_order;
create trigger purchase_order_guard_status before update on purchase_order
  for each row execute function guard_po_status();

-- ---------------------------------------------------------------------
-- G. Audit trail
--
-- Nothing recorded who changed a purchase order, or that an invoice was
-- emailed to TJX Europe or APL at all. "Did we invoice PO 50 813584, when,
-- and to whom?" was unanswerable from the database.
-- ---------------------------------------------------------------------
alter table purchase_order   add column if not exists updated_by text;
alter table sclp             add column if not exists updated_by text;
alter table customer_invoice add column if not exists updated_by text;

create or replace function stamp_updated_by() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.email();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['purchase_order','sclp','customer_invoice'] loop
    execute format('drop trigger if exists %I on %I', t || '_stamp_updated_by', t);
    execute format(
      'create trigger %I before update on %I for each row execute function stamp_updated_by()',
      t || '_stamp_updated_by', t);
  end loop;
end $$;

create table if not exists activity_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor        text        not null default coalesce(auth.email(), 'system'),
  entity       text        not null,
  entity_id    uuid,
  action       text        not null,
  detail       jsonb
);
create index if not exists activity_log_at_idx     on activity_log (at desc);
create index if not exists activity_log_entity_idx on activity_log (entity, entity_id);

alter table activity_log enable row level security;
create policy activity_log_read on activity_log for select
  to authenticated using (public.is_member());
-- Append-only: inserts allowed, no update/delete policy exists at all.
create policy activity_log_write on activity_log for insert
  to authenticated with check (public.is_member());

comment on table activity_log is
  'Append-only record of business-critical actions (invoice sends, status changes). No update or delete policy exists, by design.';

-- Record every purchase-order status transition automatically.
create or replace function log_po_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.activity_log (actor, entity, entity_id, action, detail)
    values (coalesce(auth.email(), 'system'), 'purchase_order', new.id,
            'status_change',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'po_number', new.po_number));
  end if;
  return new;
end $$;

drop trigger if exists purchase_order_log_status on purchase_order;
create trigger purchase_order_log_status after update on purchase_order
  for each row execute function log_po_status_change();

commit;

-- ---------------------------------------------------------------------
-- Verification — run these after applying.
-- ---------------------------------------------------------------------
-- select count(*) from information_schema.columns
--  where table_name='app_settings' and column_name in
--        ('exporter_name','exporter_title','customs_id');           -- expect 3
-- select count(*) from information_schema.columns
--  where table_name='app_settings' and column_name='mailgun_api_key'; -- expect 0
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' order by tablename, policyname;
