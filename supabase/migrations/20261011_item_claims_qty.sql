-- L4 fix (Oct 11, 2026): item_claims.qty allowed 0, but settle.ts treats 0 as
-- weight 1 (c.qty > 0 ? c.qty : 1), so the schema permitted a state the
-- settlement math misinterprets. Nothing in the app writes 0 (setClaimQty
-- and QtyInput both require >= 1); tighten the check to match.
alter table item_claims
  drop constraint if exists item_claims_qty_check;
alter table item_claims
  add constraint item_claims_qty_check check (qty >= 1);
