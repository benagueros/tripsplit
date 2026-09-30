-- TripSplit initial schema.
-- No user accounts anywhere. Access is scoped by unguessable trip tokens:
-- the trip-auth edge function mints a short-lived JWT containing
-- { trip_id, trip_token }, and every RLS policy below checks the token claim.

-- ---------- tables ----------

create table trips (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,          -- unguessable, in the share link
  code text not null unique,           -- short human code, link backup (e.g. CANYON-4821)
  name text not null,
  tier text not null default 'free' check (tier in ('free', 'paid')),
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
-- Names unique per trip, case-insensitively ("Ben" vs "ben" is blocked).
create unique index members_trip_name_ci on members (trip_id, lower(name));

create table expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('receipt', 'simple', 'per_day')),
  name text not null,
  amount_cents integer not null check (amount_cents >= 0),
  paid_by_member_id uuid not null references members(id) on delete restrict,
  -- per_day: { unit_count int, unit_label text, preset text }
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index expenses_trip_idx on expenses (trip_id);

create table receipt_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  name text not null,
  qty integer not null default 1 check (qty > 0),
  price_cents integer not null check (price_cents >= 0),
  sort integer not null default 0
);
create index receipt_items_expense_idx on receipt_items (expense_id);

create table item_claims (
  receipt_item_id uuid not null references receipt_items(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (receipt_item_id, member_id)
);

create table per_day_units (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  unit_index integer not null,
  label text not null,
  unique (expense_id, unit_index)
);

create table per_day_participants (
  unit_id uuid not null references per_day_units(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (unit_id, member_id)
);

create table simple_shares (
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  primary key (expense_id, member_id)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  from_member_id uuid not null references members(id) on delete restrict,
  to_member_id uuid not null references members(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index payments_trip_idx on payments (trip_id);

-- One row per receipt scan; monthly counts enforce the scan quota per tier.
create table scan_usage (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index scan_usage_trip_month_idx on scan_usage (trip_id, created_at);

-- ---------- RLS ----------

alter table trips enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table receipt_items enable row level security;
alter table item_claims enable row level security;
alter table per_day_units enable row level security;
alter table per_day_participants enable row level security;
alter table simple_shares enable row level security;
alter table payments enable row level security;
alter table scan_usage enable row level security;

-- Helper: the set of trip ids this request's JWT may touch.
create or replace function authed_trip_ids()
returns setof uuid
language sql stable security definer
as $$
  select id from trips where token = (auth.jwt() ->> 'trip_token');
$$;

create policy trip_self on trips
  for all using (id in (select authed_trip_ids()));

create policy members_trip on members
  for all using (trip_id in (select authed_trip_ids()));

create policy expenses_trip on expenses
  for all using (trip_id in (select authed_trip_ids()));

create policy receipt_items_trip on receipt_items
  for all using (expense_id in (
    select id from expenses where trip_id in (select authed_trip_ids())));

create policy item_claims_trip on item_claims
  for all using (receipt_item_id in (
    select ri.id from receipt_items ri
    join expenses e on e.id = ri.expense_id
    where e.trip_id in (select authed_trip_ids())));

create policy per_day_units_trip on per_day_units
  for all using (expense_id in (
    select id from expenses where trip_id in (select authed_trip_ids())));

create policy per_day_participants_trip on per_day_participants
  for all using (unit_id in (
    select u.id from per_day_units u
    join expenses e on e.id = u.expense_id
    where e.trip_id in (select authed_trip_ids())));

create policy simple_shares_trip on simple_shares
  for all using (expense_id in (
    select id from expenses where trip_id in (select authed_trip_ids())));

create policy payments_trip on payments
  for all using (trip_id in (select authed_trip_ids()));

create policy scan_usage_trip on scan_usage
  for all using (trip_id in (select authed_trip_ids()));
