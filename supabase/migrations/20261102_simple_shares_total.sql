-- Fix (Nov 1, 2026, Sunday full review, LOW 1): simple-expense share
-- totals were enforced only in the UI, so a direct write could unbalance
-- shares and settlement would silently drop the residual. Enforce it in
-- the database instead: the shares of a simple expense must sum to its
-- total. Chosen over a visible residual check because it closes the hole
-- for every writer, not just the UI.
--
-- DEFERRABLE INITIALLY DEFERRED, deliberately: shares are written in the
-- same transaction as their expense (see 20261102_save_rpcs.sql), and a
-- per-statement check would see a half-written state. Deferred checks run
-- at commit, when the batch is complete. This also keeps the OLD
-- two-step client working until the RPC client ships: the expense insert
-- commits with no shares yet, but no check fires on expense INSERT (only
-- on share writes and expense UPDATEs), so the old flow is unaffected.
-- The check fires only on NEW writes — pre-existing unbalanced rows are
-- untouched (see the LOW 10 audit query for those).
--
-- Cascade deletes are safe: when an expense is deleted, its shares go
-- with it, and the check skips expenses that no longer exist.

create or replace function check_simple_shares_total(p_expense_id uuid)
returns void
language plpgsql
as $$
declare
  v_type text;
  v_total integer;
  v_sum integer;
begin
  select type, amount_cents into v_type, v_total from expenses where id = p_expense_id;
  if not found then
    return; -- expense deleted (cascade) — nothing to check
  end if;
  if v_type <> 'simple' then
    return; -- only simple expenses carry simple_shares
  end if;
  select coalesce(sum(amount_cents), 0) into v_sum
  from simple_shares where expense_id = p_expense_id;
  if v_sum <> v_total then
    raise exception 'simple expense % shares sum to % but total is %', p_expense_id, v_sum, v_total;
  end if;
end;
$$;

create or replace function simple_shares_total_trigger()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    perform check_simple_shares_total(OLD.expense_id);
    return OLD;
  elsif TG_OP = 'UPDATE' and OLD.expense_id is distinct from NEW.expense_id then
    perform check_simple_shares_total(OLD.expense_id);
    perform check_simple_shares_total(NEW.expense_id);
    return NEW;
  else
    perform check_simple_shares_total(NEW.expense_id);
    return NEW;
  end if;
end;
$$;

drop trigger if exists simple_shares_total_check on simple_shares;
create constraint trigger simple_shares_total_check
  after insert or update or delete on simple_shares
  deferrable initially deferred
  for each row execute function simple_shares_total_trigger();

create or replace function simple_expense_total_trigger()
returns trigger
language plpgsql
as $$
begin
  -- Only the amount matters here, and only for simple expenses (receipt
  -- edits update receipt rows through the same table).
  if NEW.type = 'simple' then
    perform check_simple_shares_total(NEW.id);
  end if;
  return NEW;
end;
$$;

drop trigger if exists simple_expense_total_check on expenses;
create constraint trigger simple_expense_total_check
  after update on expenses
  deferrable initially deferred
  for each row execute function simple_expense_total_trigger();
