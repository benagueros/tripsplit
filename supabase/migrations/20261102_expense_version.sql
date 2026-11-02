-- Fix (Nov 1, 2026, Sunday full review, LOW 3): receipt edits are
-- last-writer-wins with no version guard. Add an optimistic-concurrency
-- version to expenses, bumped by trigger on every update. The
-- update_receipt_expense RPC (20261102_save_rpcs.sql) updates only where
-- version matches what the editor loaded, so a concurrent edit that
-- committed first makes the second edit fail cleanly instead of silently
-- overwriting it. An integer version is used instead of updated_at because
-- integers round-trip through JSON exactly; timestamps risk precision
-- mismatches on the client round-trip.
alter table expenses add column if not exists version integer not null default 1;

create or replace function bump_expense_version()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists bump_expense_version on expenses;
create trigger bump_expense_version
  before update on expenses
  for each row execute function bump_expense_version();
