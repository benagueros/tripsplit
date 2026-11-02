-- Fix (Nov 1, 2026, Sunday full review, LOW 4): trip creation was two
-- separate writes (trip, then members) — a members-insert failure left
-- an orphan trip row. This RPC inserts both in one transaction, so any
-- failure rolls the whole trip back. Called only by the trip-auth edge
-- function (service_role); code-collision retries stay in the edge
-- function, which regenerates the code and retries on unique violation.
-- Granted to service_role only — authenticated callers must go through
-- trip-auth (rate limits + validation live there, not here).

create or replace function create_trip_with_members(
  p_name text,
  p_token text,
  p_code text,
  p_member_names text[]
)
returns uuid
language plpgsql
as $$
declare
  v_trip_id uuid;
begin
  insert into trips (name, token, code)
  values (p_name, p_token, p_code)
  returning id into v_trip_id;

  insert into members (trip_id, name)
  select v_trip_id, unnest(p_member_names);

  return v_trip_id;
end;
$$;

revoke execute on function create_trip_with_members(text, text, text, text[]) from public;
grant execute on function create_trip_with_members(text, text, text, text[]) to service_role;
