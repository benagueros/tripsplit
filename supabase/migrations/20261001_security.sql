-- Security hardening (Oct 1, 2026) — fixes from external code review.
--
-- 1. trips: block privilege escalation. The trips RLS policy is FOR ALL so
--    members can update the trip name, but that also let anyone set
--    tier='paid' (or rotate the share token / subscription ids) from the
--    browser console. This trigger rejects changes to billing/identity
--    columns unless the caller is service_role (i.e. the Polar webhook).
-- 2. scan_usage: members get SELECT only. All writes go through the
--    ocr-scan edge function (service role, bypasses RLS). Previously FOR ALL
--    let anyone delete usage rows to reset their monthly quota.
-- 3. join_attempts: backing table for trip-auth join rate limiting
--    (short trip codes are human-typable, so enumeration is throttled).

create or replace function protect_trip_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if new.tier is distinct from old.tier then
    raise exception 'trips.tier can only be changed by the billing webhook';
  end if;
  if new.token is distinct from old.token then
    raise exception 'trips.token cannot be changed';
  end if;
  if new.polar_subscription_id is distinct from old.polar_subscription_id then
    raise exception 'polar_subscription_id can only be changed by the billing webhook';
  end if;
  if new.polar_customer_id is distinct from old.polar_customer_id then
    raise exception 'polar_customer_id can only be changed by the billing webhook';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_protect_billing on trips;
create trigger trips_protect_billing
  before update on trips
  for each row execute function protect_trip_billing_columns();

drop policy if exists scan_usage_trip on scan_usage;
create policy scan_usage_select on scan_usage
  for select using (trip_id in (select authed_trip_ids()));

create table if not exists join_attempts (
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_ip_time on join_attempts (ip, created_at);
alter table join_attempts enable row level security;
-- No policies: only service_role (the trip-auth function) can read/write.
