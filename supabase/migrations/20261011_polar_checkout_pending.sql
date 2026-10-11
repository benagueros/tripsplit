-- L2 fix (Oct 11, 2026): close the polar-checkout double-subscription window.
-- polar_checkout_pending_at marks an in-flight checkout; polar-checkout
-- claims it atomically and the webhook clears it on any tier change, so a
-- double-submit or a second member upgrading mid-checkout can't create two
-- Polar subscriptions for one trip. Stale markers expire after 30 minutes
-- (abandoned checkouts whose webhook never arrives).
alter table trips
  add column if not exists polar_checkout_pending_at timestamptz;

-- Backfill: free-tier trips may still carry a dead canceled subscription id
-- from before; with the pending marker as the guard, a free trip must not
-- point at any subscription.
update trips
  set polar_subscription_id = null
  where tier = 'free' and polar_subscription_id is not null;

-- The new column is billing state: only the service-role webhook/checkout
-- functions may change it (same rule as tier / polar_subscription_id).
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
  return new;
end;
$$;
