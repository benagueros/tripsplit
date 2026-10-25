-- Fix (Oct 25, 2026, Sunday full review): RLS scopes rows to the trip but
-- never checks that a member_id in a claim/share/payment actually belongs
-- to that trip. A foreign member_id absorbs cost in settlement (settle.ts
-- only outputs the trip's own members, so the foreign share vanishes from
-- balances). Validate on write: every member reference must belong to the
-- row's trip. Legitimate clients only ever use the trip's own members, and
-- no edge function writes these tables, so this blocks no real flow.
create or replace function validate_trip_member_ids()
returns trigger
language plpgsql
as $$
declare
  trip_uuid uuid;
begin
  if TG_TABLE_NAME = 'item_claims' then
    select e.trip_id into trip_uuid
    from expenses e
    join receipt_items ri on ri.expense_id = e.id
    where ri.id = NEW.receipt_item_id;
    if trip_uuid is null then
      raise exception 'receipt item not found for claim';
    end if;
    if not exists (select 1 from members where id = NEW.member_id and trip_id = trip_uuid) then
      raise exception 'member does not belong to this trip';
    end if;
  elsif TG_TABLE_NAME = 'simple_shares' then
    select trip_id into trip_uuid from expenses where id = NEW.expense_id;
    if trip_uuid is null then
      raise exception 'expense not found for share';
    end if;
    if not exists (select 1 from members where id = NEW.member_id and trip_id = trip_uuid) then
      raise exception 'member does not belong to this trip';
    end if;
  elsif TG_TABLE_NAME = 'per_day_participants' then
    select e.trip_id into trip_uuid
    from expenses e
    join per_day_units u on u.expense_id = e.id
    where u.id = NEW.unit_id;
    if trip_uuid is null then
      raise exception 'per-day unit not found for participant';
    end if;
    if not exists (select 1 from members where id = NEW.member_id and trip_id = trip_uuid) then
      raise exception 'member does not belong to this trip';
    end if;
  elsif TG_TABLE_NAME = 'payments' then
    trip_uuid := NEW.trip_id;
    if not exists (select 1 from members where id = NEW.from_member_id and trip_id = trip_uuid) then
      raise exception 'payment sender does not belong to this trip';
    end if;
    if not exists (select 1 from members where id = NEW.to_member_id and trip_id = trip_uuid) then
      raise exception 'payment recipient does not belong to this trip';
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    trip_uuid := NEW.trip_id;
    if not exists (select 1 from members where id = NEW.paid_by_member_id and trip_id = trip_uuid) then
      raise exception 'payer does not belong to this trip';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists validate_trip_members on item_claims;
create trigger validate_trip_members
  before insert or update on item_claims
  for each row execute function validate_trip_member_ids();

drop trigger if exists validate_trip_members on simple_shares;
create trigger validate_trip_members
  before insert or update on simple_shares
  for each row execute function validate_trip_member_ids();

drop trigger if exists validate_trip_members on per_day_participants;
create trigger validate_trip_members
  before insert or update on per_day_participants
  for each row execute function validate_trip_member_ids();

drop trigger if exists validate_trip_members on payments;
create trigger validate_trip_members
  before insert or update on payments
  for each row execute function validate_trip_member_ids();

drop trigger if exists validate_trip_members on expenses;
create trigger validate_trip_members
  before insert or update on expenses
  for each row execute function validate_trip_member_ids();
