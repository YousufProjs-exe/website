-- Backend setup starter for Supabase/Postgres. Review and test policies before production.
create extension if not exists pgcrypto;

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner','staff')) default 'staff',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price_paise integer not null check (price_paise >= 0),
  image_url text,
  available boolean not null default true,
  visible boolean not null default true,
  vegetarian_verified boolean not null default false,
  featured boolean not null default false,
  badge text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null unique default ('MRJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  customer_name text not null,
  customer_phone text not null,
  fulfilment text not null check (fulfilment in ('Delivery','Pickup')),
  delivery_address text,
  landmark text,
  instructions text,
  payment_method text not null default 'To be confirmed',
  payment_status text not null default 'unverified',
  status text not null default 'New' check (status in ('New','Confirmed','Preparing','Ready','Out for delivery','Completed','Cancelled')),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  delivery_fee_paise integer,
  total_paise integer not null check (total_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  unit_price_paise integer not null check (unit_price_paise >= 0),
  quantity integer not null check (quantity > 0),
  line_total_paise integer not null check (line_total_paise >= 0)
);

create table if not exists public.business_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_cake_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  cake_type text not null,
  size text,
  flavour text,
  message_on_cake text,
  preferred_date date,
  requirements text,
  reference_image_url text,
  status text not null default 'New' check (status in ('New','Reviewing','Awaiting customer','Confirmed','Completed','Cancelled')),
  staff_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_display_name text,
  rating integer check (rating between 1 and 5),
  review_text text not null,
  authorized_for_publication boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.media_library (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  public_url text,
  alt_text text not null default '',
  context text not null default 'product',
  product_id uuid references public.products(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Helper: server-side admin check. Provision admin_profiles rows only through a trusted process.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid() and ap.role in ('owner','staff')
  );
$$;

alter table public.admin_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.business_settings enable row level security;
alter table public.custom_cake_requests enable row level security;
alter table public.reviews enable row level security;
alter table public.media_library enable row level security;

-- Public storefront can read visible catalogue only.
create policy "Public can read visible categories" on public.categories for select using (visible = true);
create policy "Public can read visible products" on public.products for select using (visible = true);
create policy "Public can read approved reviews" on public.reviews for select using (authorized_for_publication = true);
create policy "Admins manage categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage profiles" on public.admin_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy "Admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage order items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage settings" on public.business_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage cake requests" on public.custom_cake_requests for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage reviews" on public.reviews for all using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage media" on public.media_library for all using (public.is_admin()) with check (public.is_admin());

-- NOTE: Do not allow public direct inserts into orders/requests until you add a safe server-side
-- function/Edge Function that validates inputs, re-reads product prices, calculates totals,
-- rate-limits requests, and inserts parent + child records atomically.
-- NOTE: Add Storage policies for a private admin-managed bucket. Do not make customer uploads
-- publicly executable; validate MIME type/size and use safe object paths.
-- NOTE: Create the owner profile via a trusted server-side provisioning flow after secure signup.
