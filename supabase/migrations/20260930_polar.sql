-- Polar monetization linkage (Sep 30, 2026).
-- Stores the Polar subscription/customer on each trip so the polar-webhook
-- edge function can upgrade/downgrade the scan tier idempotently.
alter table trips
  add column if not exists polar_subscription_id text,
  add column if not exists polar_customer_id text;
