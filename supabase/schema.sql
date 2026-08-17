-- =====================================================================
--  ShipFlow APL  —  schema generated from Base44 entity definitions
--  Target: Supabase (Postgres 15). Run once in the SQL editor.
-- =====================================================================

create extension if not exists pgcrypto;

-- Every Base44 record exposes created_date / updated_date. Keep updated_date
-- honest with a trigger rather than trusting each client write.
create or replace function touch_updated_date() returns trigger
language plpgsql as $$
begin
  new.updated_date = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles: Base44's User entity. Supabase owns auth.users; app-level
-- fields (role, etc.) live here, keyed 1:1 by auth user id.
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text unique not null,
  full_name    text,
  role         text not null default 'user' check (role in ('admin','user')),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
alter table profiles enable row level security;
create policy profiles_self_read on profiles for select
  to authenticated using (true);
create policy profiles_self_update on profiles for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_date();

-- Auto-create a profile row whenever someone signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- helper used by admin-only policies if you tighten access later
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin')
$$;

-- =====================================================================
--  Entity tables
-- =====================================================================


-- ---------- AppSettings ----------
create table if not exists app_settings (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  company_name             text,
  company_tagline          text,
  company_email            text,
  company_phone            text,
  company_address          text,
  logo_url                 text,
  primary_color            text default '#2563eb',
  sidebar_color            text default '#1e293b',
  app_title                text default 'TJX Europe Shipping Hub',
  show_logo_on_documents   boolean default false,
  white_label_mode         boolean default false,
  background_color         text default '#f3f4f6',
  card_background_color    text default '#ffffff',
  text_color               text default '#111827',
  secondary_text_color     text default '#6b7280',
  mailgun_api_key          text,
  mailgun_domain           text,
  mailgun_from_email       text,
  mailgun_from_name        text default 'Shipping Hub',
  mailgun_bcc              text,
  invoice_email_to         text default 'apinvoices@tjxcanada.ca',
  invoice_from_email       text,
  invoice_from_name        text,
  email_template_subject   text,
  email_template_body      text,
  apl_email_to             text default 'Canada_Export@apllogistics.com',
  apl_from_email           text,
  apl_from_name            text,
  apl_email_template_subject text,
  apl_email_template_body  text,
  tjx_europe_email_to      text default 'TJXEuropeAP@tjx.com',
  tjx_europe_from_email    text,
  tjx_europe_from_name     text,
  tjx_europe_email_template_subject text,
  tjx_europe_email_template_body text
);
create index if not exists app_settings_created_date_idx on app_settings (created_date desc);
create trigger app_settings_touch before update on app_settings for each row execute function touch_updated_date();
alter table app_settings enable row level security;
create policy app_settings_rw on app_settings for all
  to authenticated using (true) with check (true);

-- ---------- CustomerInvoice ----------
create table if not exists customer_invoice (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  customer                 text,
  supplier                 text,
  po                       text,
  "invoiceNumber"          text,
  "invoiceDate"            text,
  currency                 text default 'USD',
  items                    jsonb
);
create index if not exists customer_invoice_created_date_idx on customer_invoice (created_date desc);
create trigger customer_invoice_touch before update on customer_invoice for each row execute function touch_updated_date();
alter table customer_invoice enable row level security;
create policy customer_invoice_rw on customer_invoice for all
  to authenticated using (true) with check (true);

-- ---------- InboundShipment ----------
create table if not exists inbound_shipment (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  transaction_number       text,
  po_number                text,
  reference_number         text,
  ship_date                date,
  seller                   text,
  buyer                    text,
  ship_to                  text,
  report_totals            jsonb,
  items                    jsonb,
  total_cases              double precision,
  total_value              double precision,
  total_gross_weight       double precision,
  total_net_weight         double precision,
  currency                 text default 'USD',
  status                   text default 'new',
  constraint inbound_shipment_status_chk check (status is null or status in ('new', 'verified'))
);
comment on column inbound_shipment.transaction_number is 'Warehouse transaction / invoice number';
create index if not exists inbound_shipment_created_date_idx on inbound_shipment (created_date desc);
create trigger inbound_shipment_touch before update on inbound_shipment for each row execute function touch_updated_date();
alter table inbound_shipment enable row level security;
create policy inbound_shipment_rw on inbound_shipment for all
  to authenticated using (true) with check (true);

-- ---------- Product ----------
create table if not exists product (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  item_number              text not null,
  vendor_style             text,
  description              text not null,
  upc_code                 text,
  hs_code                  text,
  schedule_b               text,
  country_of_origin        text default 'USA',
  unit_price_cad           double precision,
  unit_price_usd           double precision,
  size                     text,
  units_per_carton         double precision default 6,
  carton_gross_weight_kg   double precision,
  carton_net_weight_kg     double precision,
  carton_cbm               double precision,
  is_food                  boolean default true,
  ingredients              text,
  fdc_ingredients          jsonb,
  fdc_consolidated_coo     text,
  fdc_product_of_animal_origin text,
  shelf_life_days          double precision,
  storage_instructions     text
);
comment on column product.item_number is 'Internal item/SKU number';
comment on column product.vendor_style is 'Vendor style number';
comment on column product.upc_code is '12-digit UPC barcode';
comment on column product.hs_code is 'Harmonized Tariff code';
comment on column product.schedule_b is '10-digit Schedule B export classification number';
comment on column product.unit_price_cad is 'Unit price in CAD';
comment on column product.unit_price_usd is 'Legacy: unit price in USD (kept for compatibility)';
comment on column product.size is 'e.g. 750ml';
comment on column product.carton_cbm is 'Volume per carton in M3';
comment on column product.ingredients is 'Legacy ingredients text (kept for compatibility)';
comment on column product.fdc_ingredients is 'Ingredients for Food Detail Checklist (Form 1 & 2)';
comment on column product.fdc_consolidated_coo is 'Consolidated country of origin for FDC Tab 1';
comment on column product.fdc_product_of_animal_origin is 'YES or NO';
create index if not exists product_created_date_idx on product (created_date desc);
create trigger product_touch before update on product for each row execute function touch_updated_date();
alter table product enable row level security;
create policy product_rw on product for all
  to authenticated using (true) with check (true);

-- ---------- PurchaseOrder ----------
create table if not exists purchase_order (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  po_number                text not null,
  po_prefix                text default '50' not null,
  dept_number              text default '81',
  vendor_id                text,
  invoice_number           text,
  invoice_date             date,
  freight_terms            text default 'EXW',
  currency                 text default 'CAD',
  ship_date                date,
  cancel_date              date,
  status                   text default 'draft',
  notes                    text,
  items                    jsonb,
  container_number         text,
  seal_number              text,
  container_size           text default '40HC',
  apll_booking             text,
  vessel_name              text,
  voyage_number            text,
  port_of_loading          text,
  delivery_date            date,
  total_cartons            double precision,
  total_pallets            double precision,
  total_gross_weight_kg    double precision,
  total_net_weight_kg      double precision,
  total_cbm                double precision,
  load_type                text default 'FCL',
  pre_ticketed             boolean default false,
  store_ready              boolean default false,
  security_checks          jsonb,
  apl_booking_number       text,
  apl_email_sent_at        text,
  constraint purchase_order_po_prefix_chk check (po_prefix is null or po_prefix in ('50', '55')),
  constraint purchase_order_freight_terms_chk check (freight_terms is null or freight_terms in ('FOB', 'EXW')),
  -- Base44's entity definition declared ('draft','ready','submitted','shipped'),
  -- but the app's real lifecycle is STATUS_ORDER in POForm.jsx / PurchaseOrders.jsx /
  -- emailDocs.js, and live data contains 'booked' and 'invoiced'. The definition was stale.
  constraint purchase_order_status_chk check (status is null or status in ('draft', 'ready', 'booked', 'shipped', 'invoiced')),
  constraint purchase_order_load_type_chk check (load_type is null or load_type in ('FCL', 'LCL'))
);
comment on column purchase_order.apl_booking_number is 'APL booking number saved when emailing APL';
comment on column purchase_order.apl_email_sent_at is 'ISO timestamp of when APL email was last sent';
create index if not exists purchase_order_created_date_idx on purchase_order (created_date desc);
create trigger purchase_order_touch before update on purchase_order for each row execute function touch_updated_date();
alter table purchase_order enable row level security;
create policy purchase_order_rw on purchase_order for all
  to authenticated using (true) with check (true);

-- ---------- SCLP ----------
create table if not exists sclp (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  booking_number           text not null,
  po_ids                   jsonb,
  shipment_info            jsonb,
  pallet_overrides         jsonb,
  mode                     text default 'single',
  splits                   jsonb,
  containers               jsonb,
  constraint sclp_mode_chk check (mode is null or mode in ('single', 'split'))
);
comment on column sclp.booking_number is 'APLL booking number, used as the save key';
comment on column sclp.po_ids is 'IDs of the PurchaseOrders included in this SCLP';
comment on column sclp.pallet_overrides is 'Map of poId -> pallet count override (single mode)';
comment on column sclp.splits is 'Per-PO split configuration keyed by poId';
comment on column sclp.containers is 'Up to 3 containers (split mode): number, seal, pallets';
create index if not exists sclp_created_date_idx on sclp (created_date desc);
create trigger sclp_touch before update on sclp for each row execute function touch_updated_date();
alter table sclp enable row level security;
create policy sclp_rw on sclp for all
  to authenticated using (true) with check (true);

-- ---------- Vendor ----------
create table if not exists vendor (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text        default auth.email(),
  company_name             text not null,
  address_line1            text,
  address_line2            text,
  city                     text,
  state_province           text,
  postal_code              text,
  country                  text,
  contact_name             text,
  phone                    text,
  fax                      text,
  email                    text,
  vendor_ein               text,
  vendor_number            text,
  is_default               boolean default false
);
comment on column vendor.company_name is 'Company/vendor name';
comment on column vendor.vendor_ein is 'EIN / Tax ID';
comment on column vendor.vendor_number is 'TJX Vendor Number';
create index if not exists vendor_created_date_idx on vendor (created_date desc);
create trigger vendor_touch before update on vendor for each row execute function touch_updated_date();
alter table vendor enable row level security;
create policy vendor_rw on vendor for all
  to authenticated using (true) with check (true);

-- ---------- TjxCanadaInvoiceLog ----------
-- NOTE: src/pages/TjxCanada.jsx creates (line 274) and lists (line 524) this
-- entity, but base44/entities/ has no definition for it — on Base44 this was
-- an undeclared entity. Columns below match the actual create() call site.
create table if not exists tjx_canada_invoice_log (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text default auth.email(),
  po_number    text,
  filename     text,
  pdf_url      text,
  sent_to      text,
  subject      text,
  send_method  text,
  sent_at      timestamptz
);
create index if not exists tjx_canada_invoice_log_sent_at_idx
  on tjx_canada_invoice_log (sent_at desc);
create trigger tjx_canada_invoice_log_touch before update on tjx_canada_invoice_log
  for each row execute function touch_updated_date();
alter table tjx_canada_invoice_log enable row level security;
create policy tjx_canada_invoice_log_rw on tjx_canada_invoice_log for all
  to authenticated using (true) with check (true);
