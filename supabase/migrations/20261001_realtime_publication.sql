-- Realtime publication (Oct 1, 2026): the frontend subscribes to
-- postgres_changes on expenses, payments, and item_claims for live updates
-- (see web/src/lib/store.ts). This was configured via the Supabase dashboard
-- on prod; captured here so fresh DBs built from migrations match.
-- Idempotent: safe to run even where the tables are already published.
do $$
declare
  t text;
begin
  foreach t in array array['expenses', 'payments', 'item_claims'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
