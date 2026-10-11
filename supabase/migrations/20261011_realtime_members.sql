-- L1 fix (Oct 11, 2026): publish the members table to realtime so
-- addMember/removeMember live-update other clients viewing the trip
-- (the frontend subscribes in web/src/lib/store.ts useTripData).
-- Idempotent: safe to run even where members is already published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'members'
  ) then
    alter publication supabase_realtime add table members;
  end if;
end $$;
