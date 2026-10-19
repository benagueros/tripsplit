import { useCallback, useEffect, useState } from "react";
import { authedClient } from "./supabase";
import type {
  Expense,
  Member,
  Payment,
  PerDayUnit,
  ReceiptItem,
  SimpleSplitShare,
  Trip,
} from "./types";

export interface TripData {
  trip: Trip;
  members: Member[];
  expenses: Expense[];
  receiptItems: ReceiptItem[];
  claims: Map<string, { member_id: string; qty: number }[]>;
  simpleShares: Map<string, SimpleSplitShare[]>;
  perDayUnits: Map<string, PerDayUnit[]>;
  payments: Payment[];
}

// PostgREST silently caps a single select at 1000 rows. A big trip would
// load truncated data and compute wrong balances, so page through every
// list query. RLS already scopes each query to this trip; pagination only
// defeats the row cap. The id tiebreaker keeps page boundaries stable if
// data changes mid-reload (realtime fires a fresh reload anyway).
const PAGE_SIZE = 1000;
// Keep each .in("expense_id", ...) query string well under gateway URL
// limits: 150 UUIDs ≈ 5.5KB + query overhead.
const ITEM_SCOPE_CHUNK = 150;
async function fetchAll<T>(makeQuery: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export function useTripData(tripId: string | null) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    setError(null);
    try {
      const db = authedClient();
      const expenseIdList = (
        await fetchAll<{ id: string }>(() =>
          db.from("expenses").select("id").eq("trip_id", tripId).order("id"),
        )
      ).map((e) => e.id);
      const itemScope = expenseIdList.length > 0 ? expenseIdList : ["00000000-0000-0000-0000-000000000000"];
      const [
        tripRes,
        members,
        expenses,
        items,
        claimRows,
        unitRows,
        unitPartRows,
        shareRows,
        payments,
      ] = await Promise.all([
        db.from("trips").select().eq("id", tripId).single(),
        fetchAll<Member>(() => db.from("members").select().eq("trip_id", tripId).order("created_at").order("id")),
        fetchAll<Expense>(() => db.from("expenses").select().eq("trip_id", tripId).order("created_at").order("id")),
        // Chunk the .in() list: 200+ expense ids in one query string can
        // exceed gateway URL limits (~8KB) and fail the whole load.
        // Each chunk stays sorted; re-sort after concatenating.
        (async () => {
          const out: ReceiptItem[] = [];
          for (let i = 0; i < itemScope.length; i += ITEM_SCOPE_CHUNK) {
            const chunk = itemScope.slice(i, i + ITEM_SCOPE_CHUNK);
            out.push(
              ...(await fetchAll<ReceiptItem>(() =>
                db.from("receipt_items").select().in("expense_id", chunk).order("sort").order("id"),
              )),
            );
          }
          out.sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          return out;
        })(),
        fetchAll<{ receipt_item_id: string; member_id: string; qty?: number }>(() => db.from("item_claims").select().order("id")),
        fetchAll<{ id: string; expense_id: string; unit_index: number; label: string }>(() => db.from("per_day_units").select().order("id")),
        fetchAll<{ unit_id: string; member_id: string }>(() => db.from("per_day_participants").select().order("id")),
        fetchAll<{ expense_id: string; member_id: string; amount_cents: number }>(() => db.from("simple_shares").select().order("id")),
        fetchAll<Payment>(() => db.from("payments").select().eq("trip_id", tripId).order("created_at").order("id")),
      ]);
      if (tripRes.error) throw tripRes.error;

      const expenseIds = new Set(expenses.map((e) => e.id));

      const claims = new Map<string, { member_id: string; qty: number }[]>();
      for (const c of claimRows) {
        const arr = claims.get(c.receipt_item_id) ?? [];
        arr.push({ member_id: c.member_id, qty: c.qty ?? 1 });
        claims.set(c.receipt_item_id, arr);
      }

      const unitsByExpense = new Map<string, PerDayUnit[]>();
      const partsByUnit = new Map<string, string[]>();
      for (const p of unitPartRows) {
        const arr = partsByUnit.get(p.unit_id) ?? [];
        arr.push(p.member_id);
        partsByUnit.set(p.unit_id, arr);
      }
      for (const u of unitRows) {
        if (!expenseIds.has(u.expense_id)) continue;
        const arr = unitsByExpense.get(u.expense_id) ?? [];
        arr.push({
          id: u.id,
          expense_id: u.expense_id,
          unit_index: u.unit_index,
          label: u.label,
          member_ids: partsByUnit.get(u.id) ?? [],
        });
        unitsByExpense.set(u.expense_id, arr);
      }
      for (const arr of unitsByExpense.values()) arr.sort((a, b) => a.unit_index - b.unit_index);

      const simpleShares = new Map<string, SimpleSplitShare[]>();
      for (const s of shareRows) {
        if (!expenseIds.has(s.expense_id)) continue;
        const arr = simpleShares.get(s.expense_id) ?? [];
        arr.push({ member_id: s.member_id, amount_cents: s.amount_cents });
        simpleShares.set(s.expense_id, arr);
      }

      setData({
        trip: tripRes.data,
        members,
        expenses,
        receiptItems: items.filter((it) => expenseIds.has(it.expense_id)),
        claims,
        simpleShares,
        perDayUnits: unitsByExpense,
        payments,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trip.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime: refresh on any change to this trip's tables.
  useEffect(() => {
    if (!tripId) return;
    let channel: { unsubscribe: () => void } | null = null;
    try {
      const db = authedClient();
      channel = db
        .channel(`trip-${tripId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => reload())
        .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => reload())
        .on("postgres_changes", { event: "*", schema: "public", table: "item_claims" }, () => reload())
        .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => reload())
        .subscribe();
    } catch {
      /* realtime is best-effort; manual refresh still works */
    }
    return () => { channel?.unsubscribe(); };
  }, [tripId, reload]);

  return { data, error, loading, reload };
}

// ---------- mutations ----------

export async function saveReceiptExpense(args: {
  tripId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  items: { tempId: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by client-side temp id
}): Promise<string> {
  const db = authedClient();
  const { data: expense, error } = await db.from("expenses").insert({
    trip_id: args.tripId, type: "receipt", name: args.name,
    amount_cents: args.totalCents, paid_by_member_id: args.paidBy,
  }).select().single();
  if (error || !expense) throw error ?? new Error("Save failed");

  const { data: items, error: itemErr } = await db.from("receipt_items").insert(
    args.items.map((it, i) => ({
      expense_id: expense.id, name: it.name, qty: it.qty,
      price_cents: it.price_cents, sort: i,
    }))
  ).select();
  if (itemErr) {
    // Don't leave an orphaned expense row behind on failure.
    await db.from("expenses").delete().eq("id", expense.id);
    throw itemErr;
  }

  // Map client temp ids -> real ids via the sort index assigned at insert.
  // Claims are looked up by each item's OWN tempId — never by position —
  // so deleting or re-adding items can't misattach or drop claims.
  const realIdBySort = new Map(
    ((items ?? []) as { id: string; sort: number }[]).map((r) => [r.sort, r.id])
  );
  const rows: { receipt_item_id: string; member_id: string; qty: number }[] = [];
  args.items.forEach((it, i) => {
    const realId = realIdBySort.get(i);
    if (!realId) return;
    for (const c of args.claims.get(it.tempId) ?? []) {
      rows.push({ receipt_item_id: realId, member_id: c.member_id, qty: c.qty });
    }
  });
  if (rows.length > 0) {
    const { error: claimErr } = await db.from("item_claims").insert(rows);
    if (claimErr) {
      // Deleting the expense cascades to its items; don't leave a
      // claim-less receipt behind on failure.
      await db.from("expenses").delete().eq("id", expense.id);
      throw claimErr;
    }
  }
  return expense.id;
}

/** Load a receipt expense with its items and claims for editing. */
export async function getReceiptForEdit(expenseId: string): Promise<{
  name: string;
  totalCents: number;
  paidBy: string;
  items: { id: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by item id
}> {
  const db = authedClient();
  const { data: expense, error: expErr } = await db.from("expenses")
    .select("name, amount_cents, paid_by_member_id").eq("id", expenseId).single();
  if (expErr || !expense) throw expErr ?? new Error("Receipt not found");

  const { data: items, error: itemErr } = await db.from("receipt_items")
    .select("id, name, qty, price_cents").eq("expense_id", expenseId).order("sort");
  if (itemErr) throw itemErr;

  const itemIds = (items ?? []).map((it: { id: string }) => it.id);
  const claims = new Map<string, { member_id: string; qty: number }[]>();
  if (itemIds.length > 0) {
    const { data: claimRows, error: claimErr } = await db.from("item_claims")
      .select("receipt_item_id, member_id, qty").in("receipt_item_id", itemIds);
    if (claimErr) throw claimErr;
    for (const r of claimRows ?? []) {
      const list = claims.get(r.receipt_item_id) ?? [];
      list.push({ member_id: r.member_id, qty: r.qty });
      claims.set(r.receipt_item_id, list);
    }
  }
  return {
    name: expense.name,
    totalCents: expense.amount_cents,
    paidBy: expense.paid_by_member_id,
    items: (items ?? []).map((it: { id: string; name: string; qty: number; price_cents: number }) => ({
      id: it.id, name: it.name, qty: it.qty, price_cents: it.price_cents,
    })),
    claims,
  };
}

/** Update a receipt expense: replaces items and claims wholesale. */
export async function updateReceiptExpense(args: {
  expenseId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  items: { tempId: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by client-side temp id
}): Promise<void> {
  const db = authedClient();
  const { error: expErr } = await db.from("expenses").update({
    name: args.name, amount_cents: args.totalCents, paid_by_member_id: args.paidBy,
  }).eq("id", args.expenseId);
  if (expErr) throw expErr;

  // Insert the NEW items + claims BEFORE deleting the old ones: a failure
  // mid-way leaves the receipt's existing data intact instead of destroying
  // it (the old delete-first order wiped items/claims permanently when the
  // re-insert failed, e.g. on a constraint violation).
  const { data: oldItems, error: oldErr } = await db.from("receipt_items")
    .select("id").eq("expense_id", args.expenseId);
  if (oldErr) throw oldErr;
  const oldIds = ((oldItems ?? []) as { id: string }[]).map((r) => r.id);

  const { data: items, error: itemErr } = await db.from("receipt_items").insert(
    args.items.map((it, i) => ({
      expense_id: args.expenseId, name: it.name, qty: it.qty,
      price_cents: it.price_cents, sort: i,
    }))
  ).select();
  if (itemErr) throw itemErr;

  const newIds = ((items ?? []) as { id: string }[]).map((r) => r.id);
  const rows: { receipt_item_id: string; member_id: string; qty: number }[] = [];
  const realIdBySort = new Map(
    ((items ?? []) as { id: string; sort: number }[]).map((r) => [r.sort, r.id])
  );
  args.items.forEach((it, i) => {
    const realId = realIdBySort.get(i);
    if (!realId) return;
    for (const c of args.claims.get(it.tempId) ?? []) {
      rows.push({ receipt_item_id: realId, member_id: c.member_id, qty: c.qty });
    }
  });
  if (rows.length > 0) {
    const { error: claimErr } = await db.from("item_claims").insert(rows);
    if (claimErr) {
      // Best-effort rollback of what we just added; the old items are untouched.
      if (newIds.length > 0) await db.from("receipt_items").delete().in("id", newIds);
      throw claimErr;
    }
  }

  // Old items (and their claims via cascade) go away only after the new
  // data is safely stored.
  if (oldIds.length > 0) {
    const { error: delErr } = await db.from("receipt_items").delete().in("id", oldIds);
    if (delErr) throw delErr;
  }
}

export async function saveSimpleExpense(args: {
  tripId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  shares: SimpleSplitShare[];
}) {
  const db = authedClient();
  const { data: expense, error } = await db.from("expenses").insert({
    trip_id: args.tripId, type: "simple", name: args.name,
    amount_cents: args.totalCents, paid_by_member_id: args.paidBy,
  }).select().single();
  if (error || !expense) throw error ?? new Error("Save failed");
  const { error: shareErr } = await db.from("simple_shares").insert(
    args.shares.map((s) => ({
      expense_id: expense.id, member_id: s.member_id, amount_cents: s.amount_cents,
    }))
  );
  if (shareErr) {
    await db.from("expenses").delete().eq("id", expense.id);
    throw shareErr;
  }
  return expense.id;
}

export async function savePerDayExpense(args: {
  tripId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  unitLabel: string;
  preset: string;
  units: { label: string; memberIds: string[] }[];
}) {
  const db = authedClient();
  // Fairness rule: every unit must have at least one participant.
  const empty = args.units.findIndex((u) => u.memberIds.length === 0);
  if (empty >= 0) throw new Error(`"${args.units[empty].label}" has nobody in it — add someone or remove the ${args.unitLabel}.`);

  const { data: expense, error } = await db.from("expenses").insert({
    trip_id: args.tripId, type: "per_day", name: args.name,
    amount_cents: args.totalCents, paid_by_member_id: args.paidBy,
    meta: { unit_count: args.units.length, unit_label: args.unitLabel, preset: args.preset },
  }).select().single();
  if (error || !expense) throw error ?? new Error("Save failed");

  const { data: unitRows, error: unitErr } = await db.from("per_day_units").insert(
    args.units.map((u, i) => ({ expense_id: expense.id, unit_index: i, label: u.label }))
  ).select();
  if (unitErr) {
    await db.from("expenses").delete().eq("id", expense.id);
    throw unitErr;
  }

  const rows: { unit_id: string; member_id: string }[] = [];
  (unitRows ?? []).forEach((real: { id: string; unit_index: number }) => {
    for (const mid of args.units[real.unit_index].memberIds) {
      rows.push({ unit_id: real.id, member_id: mid });
    }
  });
  if (rows.length > 0) {
    const { error: partErr } = await db.from("per_day_participants").insert(rows);
    if (partErr) {
      // Cascades to units; don't leave a participant-less expense behind.
      await db.from("expenses").delete().eq("id", expense.id);
      throw partErr;
    }
  }
  return expense.id;
}

export async function recordPayment(args: {
  tripId: string;
  from: string;
  to: string;
  amountCents: number;
}) {
  const db = authedClient();
  const { error } = await db.from("payments").insert({
    trip_id: args.tripId, from_member_id: args.from, to_member_id: args.to,
    amount_cents: args.amountCents, status: "pending",
  });
  if (error) throw error;
}

export async function confirmPayment(paymentId: string) {
  const db = authedClient();
  const { error } = await db.from("payments").update({
    status: "confirmed", confirmed_at: new Date().toISOString(),
  }).eq("id", paymentId);
  if (error) throw error;
}

export async function deleteExpense(expenseId: string) {
  const db = authedClient();
  const { error } = await db.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
}

/** Add a member to an existing trip (for late joiners, plus-ones, ...). */
export async function addMember(tripId: string, name: string) {
  // NFC-normalize so visually identical names ("José" precomposed vs.
  // e + combining accent) can't slip past uniqueness as two members.
  const clean = name.trim().normalize("NFC");
  if (!clean) throw new Error("Enter a name.");
  if (clean.length > 40) throw new Error("Keep names to 40 characters or less.");
  const db = authedClient();
  // Names must stay unique (case-insensitive) within the trip — mirrors
  // the trip-auth create validation so claims and settlements stay legible.
  const { data: existing } = await db.from("members").select("name").eq("trip_id", tripId);
  const names = ((existing ?? []) as { name: string }[]).map((m) => m.name.toLowerCase());
  if (names.includes(clean.toLowerCase())) {
    throw new Error("That name is already on this trip — add a last name or initial.");
  }
  const { data, error } = await db
    .from("members")
    .insert({ trip_id: tripId, name: clean })
    .select()
    .single();
  if (error) {
    // Unique index members_trip_name_ci (trip_id, lower(name)): the pre-check
    // above can lose a race between two tabs — surface the friendly message.
    if (error.code === "23505") {
      throw new Error("That name is already on this trip — add a last name or initial.");
    }
    throw error;
  }
  if (!data) throw new Error("Couldn't add them.");
  return data as { id: string; name: string };
}

/**
 * Remove a member. Only allowed when they have no money tied to the trip —
 * no expenses paid, no claims, no shares, no per-day participation, no
 * payments. (Most of those cascade on delete, but paid_by and payments are
 * RESTRICT, and silently dropping someone's history would corrupt balances.)
 */
export async function removeMember(memberId: string) {
  const db = authedClient();
  const { data: member } = await db
    .from("members")
    .select("id, name")
    .eq("id", memberId)
    .single();
  if (!member) throw new Error("Person not found.");
  const checks = await Promise.all([
    db.from("expenses").select("id", { count: "exact", head: true }).eq("paid_by_member_id", memberId),
    db.from("item_claims").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("simple_shares").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("per_day_participants").select("unit_id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("payments").select("id", { count: "exact", head: true })
      .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`),
  ]);
  if (checks.some((r) => (r.count ?? 0) > 0)) {
    throw new Error(
      `${(member as { name: string }).name} has expenses, claims, or payments on this trip — settle up first.`
    );
  }
  const { error } = await db.from("members").delete().eq("id", memberId);
  if (error) throw error;
}
