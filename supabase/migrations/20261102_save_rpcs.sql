-- Fix (Nov 1, 2026, Sunday full review, LOW 2): expense saves were
-- multi-step client writes (expense, then items/shares/units, then
-- claims/participants) with only best-effort cleanup — an interruption
-- mid-save could orphan or duplicate rows. These RPCs do each save in a
-- single transaction: any statement failing rolls the whole save back.
--
-- SECURITY INVOKER (the default): every statement inside runs as the
-- calling authenticated role, so the existing RLS policies gate each
-- write exactly as they did for the direct client writes. Nothing here
-- bypasses RLS, and the member-validation trigger still fires on
-- claim/share/participant inserts. Granted to authenticated only.
--
-- JSON shapes (arrays of objects, in client order):
--   p_items:  [{name, qty, price_cents, sort}]
--   p_claims: [{item_sort, member_id, qty}]  (item_sort matches p_items sort)
--   p_shares: [{member_id, amount_cents}]
--   p_units:  [{label, member_ids: [uuid, ...]}]  (unit_index = array order)

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

-- ---------- receipt update (with optimistic concurrency, LOW 3) ----------
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
begin
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

revoke execute on function save_receipt_expense(uuid, text, integer, uuid, jsonb, jsonb) from public;
revoke execute on function update_receipt_expense(uuid, integer, text, integer, uuid, jsonb, jsonb) from public;
revoke execute on function save_simple_expense(uuid, text, integer, uuid, jsonb) from public;
revoke execute on function save_per_day_expense(uuid, text, integer, uuid, text, text, jsonb) from public;
grant execute on function save_receipt_expense(uuid, text, integer, uuid, jsonb, jsonb) to authenticated;
grant execute on function update_receipt_expense(uuid, integer, text, integer, uuid, jsonb, jsonb) to authenticated;
grant execute on function save_simple_expense(uuid, text, integer, uuid, jsonb) to authenticated;
grant execute on function save_per_day_expense(uuid, text, integer, uuid, text, text, jsonb) to authenticated;
