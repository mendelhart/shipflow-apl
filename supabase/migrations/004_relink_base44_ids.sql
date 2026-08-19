-- 004_relink_base44_ids.sql
--
-- Base44 used 24-character hex ids (e.g. 69b782fcffbc3acc1380d7e1).
-- The original import converted PRIMARY KEYS to derived UUIDs but left the
-- REFERENCING columns holding the old 24-char strings, so every foreign
-- reference was dangling:
--     purchase_order.vendor_id        20 stale / 0 valid
--     purchase_order.items[].product_id  161 stale / 0 valid
--     sclp.po_ids                      4 stale
--
-- Symptom in the app: "Vendor not found for PO 456628".
--
-- The derivation used at import time is reproduced below and was verified to
-- match the actual primary keys exactly for all 20 vendors / 76 products.
--
-- SAFE TO RE-RUN: each UPDATE only touches rows whose reference does not
-- already resolve, so a second run is a no-op.

begin;

-- ---------------------------------------------------------------------------
-- Base44 24-char hex id  ->  the UUID that was generated for it at import
-- 8-4-4-4-(4 + first 8) = 32 hex chars
-- ---------------------------------------------------------------------------
create or replace function b44_to_uuid(b44 text) returns text
language sql immutable as $$
  select case when b44 ~ '^[0-9a-f]{24}$'
    then substr(b44,1,8)||'-'||substr(b44,9,4)||'-'||substr(b44,13,4)||'-'||
         substr(b44,17,4)||'-'||substr(b44,21,4)||substr(b44,1,8)
    else null end
$$;

-- ---------------------------------------------------------------------------
-- 1. purchase_order.vendor_id  (text column referencing vendor.id uuid)
-- ---------------------------------------------------------------------------
update purchase_order po
   set vendor_id = b44_to_uuid(po.vendor_id)
 where po.vendor_id ~ '^[0-9a-f]{24}$'
   and exists (select 1 from vendor v where v.id::text = b44_to_uuid(po.vendor_id));

-- ---------------------------------------------------------------------------
-- 2. purchase_order.items[].product_id  (jsonb array)
--    Rebuilt with `with ordinality` + `order by ord` so line order is preserved.
-- ---------------------------------------------------------------------------
update purchase_order po
   set items = sub.new_items
  from (
    select p.id,
           jsonb_agg(
             case
               when elem->>'product_id' ~ '^[0-9a-f]{24}$'
                    and exists (select 1 from product pr
                                 where pr.id::text = b44_to_uuid(elem->>'product_id'))
               then jsonb_set(elem, '{product_id}',
                              to_jsonb(b44_to_uuid(elem->>'product_id')))
               else elem
             end
             order by ord
           ) as new_items
      from purchase_order p,
           lateral jsonb_array_elements(p.items) with ordinality as t(elem, ord)
     where jsonb_typeof(p.items) = 'array'
     group by p.id
  ) sub
 where po.id = sub.id
   and po.items is distinct from sub.new_items;

-- ---------------------------------------------------------------------------
-- 3. sclp.po_ids  (text[] referencing purchase_order.id)
-- ---------------------------------------------------------------------------
update sclp s
   set po_ids = sub.new_ids
  from (
    select x.id,
           array_agg(
             case when e ~ '^[0-9a-f]{24}$'
                       and exists (select 1 from purchase_order p
                                    where p.id::text = b44_to_uuid(e))
                  then b44_to_uuid(e)
                  else e end
             order by ord
           ) as new_ids
      from sclp x,
           lateral unnest(x.po_ids) with ordinality as t(e, ord)
     group by x.id
  ) sub
 where s.id = sub.id
   and s.po_ids is distinct from sub.new_ids;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION -- expect 0 / 0 / 0 on every row
-- ---------------------------------------------------------------------------
select 'purchase_order.vendor_id' as ref,
       count(*) filter (where vendor_id ~ '^[0-9a-f]{24}$') as still_stale,
       count(*) filter (where not exists
             (select 1 from vendor v where v.id::text = po.vendor_id)) as unresolved
  from purchase_order po
union all
select 'items[].product_id',
       count(*) filter (where elem->>'product_id' ~ '^[0-9a-f]{24}$'),
       count(*) filter (where not exists
             (select 1 from product pr where pr.id::text = elem->>'product_id'))
  from purchase_order p,
       lateral jsonb_array_elements(p.items) as elem
union all
select 'sclp.po_ids',
       count(*) filter (where e ~ '^[0-9a-f]{24}$'),
       count(*) filter (where not exists
             (select 1 from purchase_order p where p.id::text = e))
  from sclp x, lateral unnest(x.po_ids) as e;
