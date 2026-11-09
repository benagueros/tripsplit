-- Fix (Nov 8, 2026, Sunday full review, LOW): the share-total check never
-- fired on expense INSERT, so a directly-inserted simple expense with no
-- shares stayed unbalanced and settlement silently dropped the residual.
-- The INSERT check was deliberately omitted in 20261102_simple_shares_total.sql
-- to keep the old two-step client working until the RPC client shipped.
-- The RPC client has shipped (Nov 2) and no direct expense inserts remain
-- in web/src — every save goes through the save RPCs, which insert expense
-- + shares in one transaction, so the deferred check fires at commit when
-- the batch is complete. Extending the existing trigger to INSERT closes
-- the hole for every writer, not just the UI.

drop trigger if exists simple_expense_total_check on expenses;
create constraint trigger simple_expense_total_check
  after insert or update on expenses
  deferrable initially deferred
  for each row execute function simple_expense_total_trigger();
