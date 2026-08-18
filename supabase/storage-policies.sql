-- =====================================================================
--  Storage buckets and policies
--  This is what is applied to the live project. Idempotent.
-- =====================================================================
--
--  WHY: the original bucket policy granted the `anon` role access. The anon
--  key ships inside the browser bundle by design, so anyone holding it could
--  list, read and upload documents without ever signing in.
--
--  After this, only a genuinely signed-in session can touch either bucket.
--  Existing files and already-issued signed URLs keep working — signed URLs
--  are validated by signature, not by these policies.
-- =====================================================================

-- ShipFlow's bucket. Private: a public bucket ignores RLS entirely.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Next Level's bucket, which shares this project.
update storage.buckets set public = false where id = 'invoices';

-- Remove any pre-existing policy on either bucket, whatever it was named.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(invoices|uploads)'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
    raise notice 'dropped %', pol.policyname;
  end loop;
end $$;

create policy "buckets read (authenticated)" on storage.objects for select
  to authenticated using (bucket_id in ('invoices','uploads'));

create policy "buckets insert (authenticated)" on storage.objects for insert
  to authenticated with check (bucket_id in ('invoices','uploads') and owner = auth.uid());

create policy "buckets update (owner or admin)" on storage.objects for update
  to authenticated using (bucket_id in ('invoices','uploads')
                          and (owner = auth.uid() or public.is_admin()));

create policy "buckets delete (owner or admin)" on storage.objects for delete
  to authenticated using (bucket_id in ('invoices','uploads')
                          and (owner = auth.uid() or public.is_admin()));

-- Verify: expect exactly these four, all scoped to {authenticated}.
select policyname, cmd, roles from pg_policies
 where schemaname = 'storage' and tablename = 'objects' order by policyname;
