-- Fix (Nov 8, 2026, Sunday full review, LOW): removeMember's "no money
-- tied" guard lived only in the UI, so a direct PostgREST DELETE cascaded
-- claims/shares and corrupted balances. Enforce it in the database: a
-- member with any expenses paid, claims, shares, per-day participation,
-- or payments cannot be deleted. Mirrors the client guard in
-- web/src/lib/store.ts removeMember (same five checks). paid_by and
-- payments are already RESTRICT FKs, but the trigger gives a clean error
-- instead of a raw FK violation, and covers the cascading tables.
-- Trips themselves have no DELETE (20261025), so members are only deleted
-- through removeMember — this trigger cannot break any other flow.

create or replace function guard_member_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from expenses where paid_by_member_id = OLD.id) then
    raise exception 'Member has expenses on this trip — settle up first.';
  end if;
  if exists (select 1 from item_claims where member_id = OLD.id) then
    raise exception 'Member has claims on this trip — settle up first.';
  end if;
  if exists (select 1 from simple_shares where member_id = OLD.id) then
    raise exception 'Member has shares on this trip — settle up first.';
  end if;
  if exists (select 1 from per_day_participants where member_id = OLD.id) then
    raise exception 'Member has per-day participation on this trip — settle up first.';
  end if;
  if exists (select 1 from payments where from_member_id = OLD.id or to_member_id = OLD.id) then
    raise exception 'Member has payments on this trip — settle up first.';
  end if;
  return OLD;
end;
$$;

drop trigger if exists guard_member_delete on members;
create trigger guard_member_delete
  before delete on members
  for each row execute function guard_member_delete();
