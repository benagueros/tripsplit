-- Fix (Oct 25, 2026, Sunday full review): the trips RLS policy was FOR ALL,
-- so any request holding a trip JWT could DELETE the entire trip row (and
-- cascade everything under it). No code path deletes a trip (verified Oct 25:
-- no DELETE on trips in web/ or the edge functions; service_role bypasses
-- RLS, so any future server-side delete still works). Split into
-- per-command policies that preserve the existing SELECT/INSERT/UPDATE
-- behavior exactly and grant no DELETE. Wrapped in a transaction so the
-- drop + recreate is atomic (no window with no policy at all).
begin;
drop policy if exists trip_self on trips;
create policy trip_self_select on trips
  for select using (id in (select authed_trip_ids()));
create policy trip_self_insert on trips
  for insert with check (id in (select authed_trip_ids()));
create policy trip_self_update on trips
  for update using (id in (select authed_trip_ids()))
  with check (id in (select authed_trip_ids()));
-- No DELETE policy: client-JWT trip deletion is denied by RLS.
commit;
