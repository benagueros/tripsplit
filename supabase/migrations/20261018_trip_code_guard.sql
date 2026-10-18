-- Fix (Oct 18, 2026, Sunday full review): protect_trip_billing_columns()
-- did not guard trips.code. The trips RLS policy (trip_self) lets any
-- request holding the trip JWT UPDATE any column of the trips row, so a
-- member could rewrite the 6-digit join code from the browser console and
-- break joining for everyone else (griefing/DoS). Verified Oct 18 that
-- nothing ever updates code after creation (no UPDATE of trips.code in
-- web/ or the edge functions), so guarding it breaks no legitimate flow.
-- Also adds polar_last_event_id — webhook tie-break bookkeeping written
-- alongside polar_last_event_ts — to the guarded set for consistency.
--
-- CANONICAL GUARD LIST (Oct 18, 2026): protect_trip_billing_columns() must
-- guard ALL of: tier, token, code, polar_subscription_id, polar_customer_id,
-- polar_checkout_pending_at, polar_last_event_ts, polar_last_event_id.
-- Rule: any future migration redefining this function must start from THIS
-- file's version (never an older copy) and update this list when adding a
-- guard. The Oct 11 migration copied the Oct 1 version and silently dropped
-- the polar_last_event_ts guard — that's why this list exists.
alter table trips add column if not exists polar_last_event_id text;

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
  if new.code is distinct from old.code then
    raise exception 'trips.code cannot be changed';
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
  if new.polar_last_event_id is distinct from old.polar_last_event_id then
    raise exception 'polar_last_event_id can only be changed by the billing webhook';
  end if;
  return new;
end;
$$;
