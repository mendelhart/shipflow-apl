-- =====================================================================
--  Storage lockdown
--  Project: shiptool (nscoiiinosqhraoujcss)
--  Run in the Supabase SQL editor.
-- =====================================================================
--
--  WHY: the existing bucket policy grants the `anon` role access. The anon
--  key is, by design, public — it ships inside the browser bundle, and in
--  this app it was additionally stored in a CompanySettings row that every
--  signed-in user could read. Anyone holding it could therefore list, read
--  and upload invoice PDFs without ever logging in.
--
--  AFTER: only a genuinely signed-in session (a real JWT from Supabase Auth)
--  can touch the bucket. Existing files and already-issued signed URLs keep
--  working — signed URLs are validated by signature, not by these policies.
-- =====================================================================

-- Make sure the bucket is private. A public bucket ignores RLS entirely.
update storage.buckets
   set public = false,
       file_size_limit = 52428800          -- 50 MB, matches the old default
 where id = 'invoices';

-- Drop whatever anon-scoped policies exist on the objects table for this
-- bucket. Names vary depending on how they were created in the dashboard,
-- so this removes any policy that mentions the bucket and grants anon.
do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and (qual   ilike '%invoices%' or with_check ilike '%invoices%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
    raise notice 'dropped storage policy: %', pol.policyname;
  end loop;
end $$;

-- Read: any signed-in user.
create policy "invoices read (authenticated)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'invoices');

-- Write: any signed-in user, and the uploader is recorded as the owner.
create policy "invoices insert (authenticated)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoices' and owner = auth.uid());

-- Update / delete: only the uploader, or an admin.
create policy "invoices update (owner or admin)"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));

create policy "invoices delete (owner or admin)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));

-- Verify: should list exactly the four policies above.
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
