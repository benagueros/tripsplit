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
  // Only the columns reload() selects: the trips row also carries the share
  // token, the join code, and Polar billing columns, which this screen
  // never uses (the share link comes from the session, not this row).
  trip: Pick<Trip, "id" | "name" | "tier">;
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
        // Select only the columns the UI needs: the trips row also carries
        // the share token, the join code, and Polar billing columns, none
        // of which this screen uses (the share link comes from the session,
        // not this row). Narrowing the select keeps them out of the client.
        db.from("trips").select("id,name,tier").eq("id", tripId).single(),
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
        fetchAll<{ receipt_item_id: string; member_id: string; qty?: number }>(() => db.from("item_claims").select().order("receipt_item_id").order("member_id")),
        fetchAll<{ id: string; expense_id: string; unit_index: number; label: string }>(() => db.from("per_day_units").select().order("id")),
        fetchAll<{ unit_id: string; member_id: string }>(() => db.from("per_day_participants").select().order("unit_id").order("member_id")),
        fetchAll<{ expense_id: string; member_id: string; amount_cents: number }>(() => db.from("simple_shares").select().order("expense_id").order("member_id")),
        fetchAll<Payment>(() => db.from("payments").select().eq("trip_id", tripId).order("created_at").order("id")),
      ]);
      if (tripRes.error) throw tripRes.error;

      const expenseIds = new Set(expenses.map((e) => e.id));

      const receiptItems = items.filter((it) => expenseIds.has(it.expense_id));
      // Defense in depth: RLS already scopes claims to this trip, but drop
      // any claim that doesn't belong to a loaded item rather than letting
      // a stray row into settlement.
      const itemIds = new Set(receiptItems.map((it) => it.id));
      const claims = new Map<string, { member_id: string; qty: number }[]>();
      for (const c of claimRows) {
        if (!itemIds.has(c.receipt_item_id)) continue;
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
        receiptItems,
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
  // One RPC, one transaction (see 20261102_save_rpcs.sql): no orphaned
  // expense if the items or claims insert fails midway.
  const items = args.items.map((it, i) => ({
    name: it.name, qty: it.qty, price_cents: it.price_cents, sort: i,
  }));
  // Claims are looked up by each item's OWN tempId — never by position —
  // so deleting or re-adding items can't misattach or drop claims.
  const claims: { item_sort: number; member_id: string; qty: number }[] = [];
  args.items.forEach((it, i) => {
    for (const c of args.claims.get(it.tempId) ?? []) {
      claims.push({ item_sort: i, member_id: c.member_id, qty: c.qty });
    }
  });
  const { data, error } = await db.rpc("save_receipt_expense", {
    p_trip_id: args.tripId, p_name: args.name, p_total_cents: args.totalCents,
    p_paid_by: args.paidBy, p_items: items, p_claims: claims,
  });
  if (error) throw error;
  if (!data) throw new Error("Save failed");
  return data as string;
}

/** Load a receipt expense with its items and claims for editing. */
export async function getReceiptForEdit(expenseId: string): Promise<{
  name: string;
  totalCents: number;
  paidBy: string;
  version: number;
  items: { id: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by item id
}> {
  const db = authedClient();
  const { data: expense, error: expErr } = await db.from("expenses")
    .select("name, amount_cents, paid_by_member_id, version").eq("id", expenseId).single();
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
    version: expense.version,
    items: (items ?? []).map((it: { id: string; name: string; qty: number; price_cents: number }) => ({
      id: it.id, name: it.name, qty: it.qty, price_cents: it.price_cents,
    })),
    claims,
  };
}

/** Update a receipt expense: replaces items and claims wholesale. */
export async function updateReceiptExpense(args: {
  expenseId: string;
  expectedVersion: number;
  name: string;
  totalCents: number;
  paidBy: string;
  items: { tempId: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by client-side temp id
}): Promise<number> {
  const db = authedClient();
  // One RPC, one transaction (see 20261102_save_rpcs.sql). The RPC
  // updates only where version matches what the editor loaded, so a
  // concurrent edit that committed first fails cleanly with a
  // "changed by someone else" error instead of silently overwriting.
  // The RPC returns the fresh version — return it instead of discarding
  // it, so a future save-and-keep-editing flow refreshes from it rather
  // than reusing the stale version and tripping a spurious conflict.
  // (Today's editor closes on save and the parent clears editData, so
  // there is no live version left to refresh.)
  const items = args.items.map((it, i) => ({
    name: it.name, qty: it.qty, price_cents: it.price_cents, sort: i,
  }));
  const claims: { item_sort: number; member_id: string; qty: number }[] = [];
  args.items.forEach((it, i) => {
    for (const c of args.claims.get(it.tempId) ?? []) {
      claims.push({ item_sort: i, member_id: c.member_id, qty: c.qty });
    }
  });
  const { data: newVersion, error } = await db.rpc("update_receipt_expense", {
    p_expense_id: args.expenseId, p_expected_version: args.expectedVersion,
    p_name: args.name, p_total_cents: args.totalCents, p_paid_by: args.paidBy,
    p_items: items, p_claims: claims,
  });
  if (error) throw error;
  if (typeof newVersion !== "number") {
    throw new Error("Receipt save did not return a new version — please try again.");
  }
  return newVersion;
}

export async function saveSimpleExpense(args: {
  tripId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  shares: SimpleSplitShare[];
}) {
  const db = authedClient();
  // One RPC, one transaction (see 20261102_save_rpcs.sql). The deferred
  // shares-total trigger (20261102_simple_shares_total.sql) also checks
  // at commit that the shares sum to the total.
  const { data, error } = await db.rpc("save_simple_expense", {
    p_trip_id: args.tripId, p_name: args.name, p_total_cents: args.totalCents,
    p_paid_by: args.paidBy,
    p_shares: args.shares.map((s) => ({ member_id: s.member_id, amount_cents: s.amount_cents })),
  });
  if (error) throw error;
  if (!data) throw new Error("Save failed");
  return data as string;
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

  // One RPC, one transaction (see 20261102_save_rpcs.sql). The RPC
  // re-checks the fairness rule server-side.
  const { data, error } = await db.rpc("save_per_day_expense", {
    p_trip_id: args.tripId, p_name: args.name, p_total_cents: args.totalCents,
    p_paid_by: args.paidBy, p_unit_label: args.unitLabel, p_preset: args.preset,
    p_units: args.units.map((u) => ({ label: u.label, member_ids: u.memberIds })),
  });
  if (error) throw error;
  if (!data) throw new Error("Save failed");
  return data as string;
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

/** Delete a recorded payment (undo a mistaken mark-as-paid). */
export async function deletePayment(paymentId: string) {
  const db = authedClient();
  const { error } = await db.from("payments").delete().eq("id", paymentId);
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
    // item_claims/simple_shares are composite-PK tables with no id column;
    // selecting one errored the count query, which read as zero and let
    // the guard pass (Oct 25 review). Select a real column instead.
    db.from("item_claims").select("member_id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("simple_shares").select("member_id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("per_day_participants").select("unit_id", { count: "exact", head: true }).eq("member_id", memberId),
    db.from("payments").select("id", { count: "exact", head: true })
      .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`),
  ]);
  // Fail closed: a failed check must block removal, not read as "no items"
  // and let the cascade silently drop the member's claims/shares.
  if (checks.some((r) => r.error)) {
    throw new Error("Could not verify outstanding items — please try again.");
  }
  if (checks.some((r) => (r.count ?? 0) > 0)) {
    throw new Error(
      `${(member as { name: string }).name} has expenses, claims, or payments on this trip — settle up first.`
    );
  }
  const { error } = await db.from("members").delete().eq("id", memberId);
  if (error) throw error;
}
