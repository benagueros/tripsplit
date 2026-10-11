-- H1 fix (Oct 11, 2026): receipt_items.price_cents had CHECK (price_cents >= 0),
-- which contradicts the shipped negative-discount feature (discount/coupon/
-- adjustment lines carry negative price_cents from ocr-scan and the line-item
-- editor). Drop it so discount lines can be saved.
alter table receipt_items
  drop constraint if exists receipt_items_price_cents_check;
