-- Polar webhook event ordering (Oct 4, 2026).
--
-- The webhook now records the newest applied Polar event timestamp per trip
-- and ignores strictly-older events. Without this, a delayed "paid" event
-- for an OLD subscription could overwrite polar_subscription_id, after
-- which the old subscription's "canceled" event would downgrade a trip
-- that's actually paying on a newer subscription.
--
-- Run in the Supabase SQL editor (migrations are manual).

alter table trips
  add column if not exists polar_last_event_ts timestamptz;

-- Keep the billing-column protection trigger covering the new column:
-- only the webhook (service_role) may change billing state.
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
  if new.polar_last_event_ts is distinct from old.polar_last_event_ts then
    raise exception 'polar_last_event_ts can only be changed by the billing webhook';
  end if;
  return new;
end;
$$;
