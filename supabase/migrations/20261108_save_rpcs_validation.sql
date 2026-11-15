-- Fix (Nov 8, 2026, Sunday full review, LOW): the save RPCs trusted
-- client-side validation, so a direct caller could store empty/overlong
-- names or absurd amounts. Add server-side validation to all four RPCs.
-- Bounds are deliberately generous — they block absurdity, not real use:
-- names 1–200 chars (items/units 1–120, matching the client's own caps),
-- magnitudes capped at $1,000,000 (100,000,000 cents), qtys 1–10000,
-- sorts non-negative and distinct (they are array positions — see
-- web/src/lib/store.ts), claims must name a real item sort (the insert
-- join would otherwise silently drop them), and the payer must be a
-- member of the trip. The member-validation trigger still fires on the
-- writes themselves; this only adds the checks the trigger cannot see.
-- Amended Nov 9, 2026 (DIFF review, LOW): validate_receipt_items also
-- rejects total claimed qty above the item's qty.
-- Bodies below are otherwise unchanged from 20261102_save_rpcs.sql.

-- ---------- shared validators ----------

create or replace function validate_expense_inputs(
  p_trip_id uuid,
  p_name text,
  p_total_cents integer,
  p_paid_by uuid
)
returns void
language plpgsql
as $$
begin
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 200 then
    raise exception 'Expense name must be 1–200 characters.';
  end if;
  if p_total_cents is null or abs(p_total_cents) > 100000000 then
    raise exception 'Expense total is out of range.';
  end if;
  if p_paid_by is null or not exists (
    select 1 from members where id = p_paid_by and trip_id = p_trip_id
  ) then
    raise exception 'Payer must be a member of this trip.';
  end if;
end;
$$;

create or replace function validate_receipt_items(
  p_items jsonb,
  p_claims jsonb
)
returns void
language plpgsql
as $$
declare
  v_item_count integer;
  v_distinct_sorts integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Receipt items must be an array.';
  end if;
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' then
    raise exception 'Receipt claims must be an array.';
  end if;
  select count(*) into v_item_count from jsonb_array_elements(p_items);
  if v_item_count > 500 then
    raise exception 'Too many receipt items.';
  end if;
  if (select count(*) from jsonb_array_elements(p_claims)) > 5000 then
    raise exception 'Too many receipt claims.';
  end if;
  -- Per-item fields. jsonb_to_recordset casts missing fields to NULL,
  -- so every check names NULL explicitly.
  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(name text, qty integer, price_cents integer, sort integer)
    where x.name is null
      or length(btrim(x.name)) = 0
      or length(x.name) > 120
      or x.qty is null or x.qty < 1 or x.qty > 10000
      or x.price_cents is null or abs(x.price_cents) > 100000000
      or x.sort is null or x.sort < 0
  ) then
    raise exception 'Receipt items must have a 1–120 character name, qty 1–10000, and a non-negative sort order.';
  end if;
  -- Sorts are array positions: they must be distinct, or claims would
  -- join to the wrong items.
  select count(distinct sort) into v_distinct_sorts
  from jsonb_to_recordset(p_items) as x(sort integer);
  if v_distinct_sorts <> v_item_count then
    raise exception 'Receipt item sort orders must be distinct.';
  end if;
  -- Every claim must name a real item sort (the insert join would
  -- otherwise silently drop it) and a usable qty.
  if exists (
    select 1 from jsonb_to_recordset(p_claims)
      as c(item_sort integer, member_id uuid, qty integer)
    where c.item_sort is null
      or c.item_sort not in (
        select sort from jsonb_to_recordset(p_items) as x(sort integer)
      )
      or c.qty is null or c.qty < 1 or c.qty > 10000
  ) then
  -- Total claimed qty per item must not exceed the item's qty: over-claiming
  -- a line misattributes money (settle.ts splits proportionally, so no money
  -- is created — but the split would be wrong).
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(name text, qty integer, price_cents integer, sort integer)
    where (
      select coalesce(sum(c.qty), 0)
      from jsonb_to_recordset(p_claims) as c(item_sort integer, member_id uuid, qty integer)
      where c.item_sort = x.sort
    ) > x.qty
  ) then
    raise exception 'Claims cannot exceed an item''s quantity.';
  end if;
end;
$$;

create or replace function validate_simple_shares(p_shares jsonb)
returns void
language plpgsql
as $$
begin
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Shares must be an array.';
  end if;
  if (select count(*) from jsonb_array_elements(p_shares)) > 100 then
    raise exception 'Too many shares.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_shares) as s(member_id uuid, amount_cents integer)
    where s.amount_cents is null or abs(s.amount_cents) > 100000000
  ) then
    raise exception 'Share amounts are out of range.';
  end if;
end;
$$;

create or replace function validate_per_day_units(
  p_unit_label text,
  p_preset text,
  p_units jsonb
)
returns void
language plpgsql
as $$
begin
  if p_unit_label is null or length(btrim(p_unit_label)) = 0 or length(p_unit_label) > 120 then
    raise exception 'Unit label must be 1–120 characters.';
  end if;
  if p_preset is not null and length(p_preset) > 120 then
    raise exception 'Preset must be at most 120 characters.';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'Units must be an array.';
  end if;
  if (select count(*) from jsonb_array_elements(p_units)) > 366 then
    raise exception 'Too many units.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_units) as u
    where (u.value ->> 'label') is null
      or length(btrim(u.value ->> 'label')) = 0
      or length(u.value ->> 'label') > 120
  ) then
    raise exception 'Unit labels must be 1–120 characters.';
  end if;
end;
$$;

-- ---------- receipt create ----------

create or replace function save_receipt_expense(
  p_trip_id uuid,
  p_name text,
  p_total_cents integer,
  p_paid_by uuid,
  p_items jsonb,
  p_claims jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  perform validate_expense_inputs(p_trip_id, p_name, p_total_cents, p_paid_by);
  perform validate_receipt_items(p_items, p_claims);

  insert into expenses (trip_id, type, name, amount_cents, paid_by_member_id)
  values (p_trip_id, 'receipt', p_name, p_total_cents, p_paid_by)
  returning id into v_expense_id;

  with new_items as (
    insert into receipt_items (expense_id, name, qty, price_cents, sort)
    select v_expense_id, x.name, x.qty, x.price_cents, x.sort
    from jsonb_to_recordset(p_items) as x(name text, qty integer, price_cents integer, sort integer)
    returning id, sort
  )
  insert into item_claims (receipt_item_id, member_id, qty)
  select ni.id, c.member_id, c.qty
  from jsonb_to_recordset(p_claims) as c(item_sort integer, member_id uuid, qty integer)
  join new_items ni on ni.sort = c.item_sort;

  return v_expense_id;
end;
$$;

-- ---------- receipt update (with optimistic concurrency) ----------

create or replace function update_receipt_expense(
  p_expense_id uuid,
  p_expected_version integer,
  p_name text,
  p_total_cents integer,
  p_paid_by uuid,
  p_items jsonb,
  p_claims jsonb
)
returns integer
language plpgsql
as $$
declare
  v_old_ids uuid[];
  v_new_version integer;
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from expenses where id = p_expense_id;
  if not found then
    raise exception 'Receipt not found.';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Expected version is out of range.';
  end if;
  perform validate_expense_inputs(v_trip_id, p_name, p_total_cents, p_paid_by);
  perform validate_receipt_items(p_items, p_claims);

  -- The UPDATE locks the row, so a concurrent edit that committed first
  -- has already bumped the version and this update affects 0 rows —
  -- instead of silently overwriting it.
  update expenses
  set name = p_name, amount_cents = p_total_cents, paid_by_member_id = p_paid_by
  where id = p_expense_id and version = p_expected_version;
  if not found then
    -- RLS hides foreign rows, so "not found" here also covers "not yours".
    if exists (select 1 from expenses where id = p_expense_id) then
      raise exception 'This receipt was changed by someone else — reload to see the latest version, then try again.';
    else
      raise exception 'Receipt not found.';
    end if;
  end if;

  -- Remember the old rows before inserting the replacements, so the
  -- delete below removes exactly the old set and nothing else.
  select array_agg(id) into v_old_ids from receipt_items where expense_id = p_expense_id;

  -- Insert-new-before-delete-old, same philosophy as the old client code:
  -- the replacement exists before the old data goes away. Inside one
  -- transaction the order is belt-and-braces (any failure rolls all of it
  -- back), but it means a failure never leaves the receipt with neither
  -- old nor new items.
  with new_items as (
    insert into receipt_items (expense_id, name, qty, price_cents, sort)
    select p_expense_id, x.name, x.qty, x.price_cents, x.sort
    from jsonb_to_recordset(p_items) as x(name text, qty integer, price_cents integer, sort integer)
    returning id, sort
  )
  insert into item_claims (receipt_item_id, member_id, qty)
  select ni.id, c.member_id, c.qty
  from jsonb_to_recordset(p_claims) as c(item_sort integer, member_id uuid, qty integer)
  join new_items ni on ni.sort = c.item_sort;

  if v_old_ids is not null then
    delete from receipt_items where id = any(v_old_ids);
  end if;

  select version into v_new_version from expenses where id = p_expense_id;
  return v_new_version;
end;
$$;

-- ---------- simple create ----------

create or replace function save_simple_expense(
  p_trip_id uuid,
  p_name text,
  p_total_cents integer,
  p_paid_by uuid,
  p_shares jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  perform validate_expense_inputs(p_trip_id, p_name, p_total_cents, p_paid_by);
  perform validate_simple_shares(p_shares);

  insert into expenses (trip_id, type, name, amount_cents, paid_by_member_id)
  values (p_trip_id, 'simple', p_name, p_total_cents, p_paid_by)
  returning id into v_expense_id;

  insert into simple_shares (expense_id, member_id, amount_cents)
  select v_expense_id, s.member_id, s.amount_cents
  from jsonb_to_recordset(p_shares) as s(member_id uuid, amount_cents integer);

  return v_expense_id;
end;
$$;

-- ---------- per-day create ----------

create or replace function save_per_day_expense(
  p_trip_id uuid,
  p_name text,
  p_total_cents integer,
  p_paid_by uuid,
  p_unit_label text,
  p_preset text,
  p_units jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  perform validate_expense_inputs(p_trip_id, p_name, p_total_cents, p_paid_by);
  perform validate_per_day_units(p_unit_label, p_preset, p_units);

  -- Fairness rule, enforced server-side as well as in the client: every
  -- unit must have at least one participant.
  if exists (
    select 1 from jsonb_array_elements(p_units) as u
    where jsonb_array_length(coalesce(u.value -> 'member_ids', '[]'::jsonb)) = 0
  ) then
    raise exception 'Every unit must have at least one participant.';
  end if;

  insert into expenses (trip_id, type, name, amount_cents, paid_by_member_id, meta)
  values (
    p_trip_id, 'per_day', p_name, p_total_cents, p_paid_by,
    jsonb_build_object(
      'unit_count', jsonb_array_length(p_units),
      'unit_label', p_unit_label,
      'preset', p_preset
    )
  )
  returning id into v_expense_id;

  with new_units as (
    insert into per_day_units (expense_id, unit_index, label)
    select v_expense_id, (u.ordinality - 1)::integer, u.value ->> 'label'
    from jsonb_array_elements(p_units) with ordinality as u
    returning id, unit_index
  )
  insert into per_day_participants (unit_id, member_id)
  select nu.id, m.member_id::uuid
  from jsonb_array_elements(p_units) with ordinality as u
  join new_units nu on nu.unit_index = (u.ordinality - 1)::integer
  cross join lateral jsonb_array_elements_text(u.value -> 'member_ids') as m(member_id);

  return v_expense_id;
end;
$$;

revoke execute on function validate_expense_inputs(uuid, text, integer, uuid) from public;
revoke execute on function validate_receipt_items(jsonb, jsonb) from public;
revoke execute on function validate_simple_shares(jsonb) from public;
revoke execute on function validate_per_day_units(text, text, jsonb) from public;
grant execute on function validate_expense_inputs(uuid, text, integer, uuid) to authenticated;
grant execute on function validate_receipt_items(jsonb, jsonb) to authenticated;
grant execute on function validate_simple_shares(jsonb) to authenticated;
grant execute on function validate_per_day_units(text, text, jsonb) to authenticated;

revoke execute on function save_receipt_expense(uuid, text, integer, uuid, jsonb, jsonb) from public;
revoke execute on function update_receipt_expense(uuid, integer, text, integer, uuid, jsonb, jsonb) from public;
revoke execute on function save_simple_expense(uuid, text, integer, uuid, jsonb) from public;
revoke execute on function save_per_day_expense(uuid, text, integer, uuid, text, text, jsonb) from public;
grant execute on function save_receipt_expense(uuid, text, integer, uuid, jsonb, jsonb) to authenticated;
grant execute on function update_receipt_expense(uuid, integer, text, integer, uuid, jsonb, jsonb) to authenticated;
grant execute on function save_simple_expense(uuid, text, integer, uuid, jsonb) to authenticated;
grant execute on function save_per_day_expense(uuid, text, integer, uuid, text, text, jsonb) to authenticated;
