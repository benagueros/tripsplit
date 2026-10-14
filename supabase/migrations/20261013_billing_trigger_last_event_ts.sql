-- Fix (Oct 13, 2026): migration 20261011_polar_checkout_pending redefined
-- protect_trip_billing_columns() from the Oct 1 version, accidentally
-- dropping the polar_last_event_ts guard added in 20261004. Re-add it
-- (keeping the polar_checkout_pending_at guard). Without this, a trip
-- member could set polar_last_event_ts far in the future and freeze the
-- tier: the webhook's out-of-order guard would ignore all later events,
-- so canceled subs would never downgrade and upgrades would never apply.
-- Defensive: make sure the billing trigger is enabled — a mid-script
-- failure in 20261011 could have left it disabled.
-- Convention (Oct 13 review): migrations that must DISABLE a trigger
-- should wrap DISABLE...ENABLE in BEGIN/COMMIT, never leave a bare
-- disable/enable pair that a mid-script failure could split.
alter table trips enable trigger trips_protect_billing;

-- CANONICAL GUARD LIST (Oct 13, 2026): protect_trip_billing_columns() must
-- guard ALL of: tier, token, polar_subscription_id, polar_customer_id,
-- polar_checkout_pending_at, polar_last_event_ts.
-- Rule: any future migration redefining this function must start from THIS
-- file's version (never an older copy) and update this list when adding a
-- guard. The Oct 11 migration copied the Oct 1 version and silently dropped
-- the polar_last_event_ts guard — that's how this fix file came to exist.
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
  if new.polar_checkout_pending_at is distinct from old.polar_checkout_pending_at then
    raise exception 'polar_checkout_pending_at can only be changed by the billing webhook';
  end if;
  if new.polar_last_event_ts is distinct from old.polar_last_event_ts then
    raise exception 'polar_last_event_ts can only be changed by the billing webhook';
  end if;
  return new;
end;
$$;
