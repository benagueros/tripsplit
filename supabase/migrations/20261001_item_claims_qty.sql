-- Catch-up (Oct 1, 2026): item_claims.qty (per-person quantity weights for the
-- proportional "split N ways" feature) was added to the production DB via the
-- dashboard but never captured in migrations. A fresh DB built from the repo
-- would 400 on receipt saves/edits that read/write this column.
alter table item_claims
  add column if not exists qty integer not null default 1 check (qty >= 0);
