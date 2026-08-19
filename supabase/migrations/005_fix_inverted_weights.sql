-- 005_fix_inverted_weights.sql
--
-- Every purchase-order line carried gross 5.0 / net 5.1 — net heavier than
-- gross, which is physically impossible and a standard customs query on a
-- commercial invoice. 163 of 163 lines across all 20 POs were affected, plus
-- the cached PO totals and the one inbound_shipment row.
--
-- The two values were transposed at import. Verified against the catalog,
-- which was NOT affected and holds the correct orientation:
--
--     product.carton_gross / carton_net    products   PO lines using it
--     5.1 / 5.0                                  69                 161
--     8.7 / 6.0                                   4                   0
--     3.5 / 2.5                                   2                   0
--     5.0 / 4.0                                   1                   0
--
-- So for all 161 lines with a resolvable product, swapping reproduces the
-- catalog value exactly. The remaining 2 lines (PO 456620, "Passion Fruit
-- Guava SFCS 750ML" and "Blackberry SFCS 750ML") were entered by hand with no
-- product_id and carry the same transposed 5.0/5.1 default, so the swap
-- applies to them too.
--
-- The catalog itself is deliberately left alone — it is already correct, and
-- rewriting it would re-introduce the inversion on the next PO.
--
-- SAFE TO RE-RUN: every statement is conditioned on net > gross, so a second
-- run matches nothing.

begin;

-- ---------------------------------------------------------------------------
-- 1. purchase_order.items[] — jsonb array, rebuilt in place
--    `with ordinality` + `order by ord` keeps the line order on the invoice.
--    Values are copied as raw jsonb (e->'net_weight_kg', not ->>) so numeric
--    type and precision survive the round trip.
-- ---------------------------------------------------------------------------
update purchase_order po
   set items = sub.new_items
  from (
    select p.id,
           jsonb_agg(
             case
               when e ? 'gross_weight_kg'
                and e ? 'net_weight_kg'
                and (e->>'gross_weight_kg') ~ '^[0-9]+(\.[0-9]+)?$'
                and (e->>'net_weight_kg')   ~ '^[0-9]+(\.[0-9]+)?$'
                and (e->>'net_weight_kg')::numeric > (e->>'gross_weight_kg')::numeric
               then jsonb_set(
                      jsonb_set(e, '{gross_weight_kg}', e->'net_weight_kg'),
                      '{net_weight_kg}',   e->'gross_weight_kg')
               else e
             end
             order by ord
           ) as new_items
      from purchase_order p,
           lateral jsonb_array_elements(p.items) with ordinality as t(e, ord)
     where jsonb_typeof(p.items) = 'array'
     group by p.id
  ) sub
 where po.id = sub.id
   and po.items is distinct from sub.new_items;

-- ---------------------------------------------------------------------------
-- 2. purchase_order cached totals
--    Swapping equals recomputing here: sum(cartons) * 5.0 = 8400 and
--    sum(cartons) * 5.1 = 8568 on the PO that surfaced this.
-- ---------------------------------------------------------------------------
update purchase_order
   set total_gross_weight_kg = total_net_weight_kg,
       total_net_weight_kg   = total_gross_weight_kg
 where total_gross_weight_kg is not null
   and total_net_weight_kg   is not null
   and total_net_weight_kg > total_gross_weight_kg;

-- ---------------------------------------------------------------------------
-- 3. inbound_shipment
-- ---------------------------------------------------------------------------
update inbound_shipment
   set total_gross_weight = total_net_weight,
       total_net_weight   = total_gross_weight
 where total_gross_weight is not null
   and total_net_weight   is not null
   and total_net_weight > total_gross_weight;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION — expect 0 in every still_inverted column
-- ---------------------------------------------------------------------------
select 'po.items[]' as scope,
       count(*) filter (where (e->>'net_weight_kg')::numeric
                            > (e->>'gross_weight_kg')::numeric) as still_inverted,
       count(*) as total,
       count(*) filter (where pr.id is not null
                          and (e->>'gross_weight_kg')::numeric = pr.carton_gross_weight_kg
                          and (e->>'net_weight_kg')::numeric   = pr.carton_net_weight_kg
                        ) as matches_catalog
  from purchase_order p,
       lateral jsonb_array_elements(p.items) e
  left join product pr on pr.id::text = e->>'product_id'
union all
select 'po.totals',
       count(*) filter (where total_net_weight_kg > total_gross_weight_kg),
       count(*), null
  from purchase_order
union all
select 'inbound_shipment',
       count(*) filter (where total_net_weight > total_gross_weight),
       count(*), null
  from inbound_shipment
union all
select 'product (untouched)',
       count(*) filter (where carton_net_weight_kg > carton_gross_weight_kg),
       count(*), null
  from product;
