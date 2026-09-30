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
      const expenseIdsRes = await db.from("expenses").select("id").eq("trip_id", tripId);
      const expenseIdList: string[] = expenseIdsRes.data?.map((e) => e.id) ?? [];
      const itemScope = expenseIdList.length > 0 ? expenseIdList : ["00000000-0000-0000-0000-000000000000"];
      const [
        tripRes,
        membersRes,
        expensesRes,
        itemsRes,
        claimsRes,
        unitsRes,
        unitPartsRes,
        sharesRes,
        paymentsRes,
      ] = await Promise.all([
        db.from("trips").select().eq("id", tripId).single(),
        db.from("members").select().eq("trip_id", tripId).order("created_at"),
        db.from("expenses").select().eq("trip_id", tripId).order("created_at"),
        db.from("receipt_items").select().in("expense_id", itemScope).order("sort"),
        db.from("item_claims").select(),
        db.from("per_day_units").select(),
        db.from("per_day_participants").select(),
        db.from("simple_shares").select(),
        db.from("payments").select().eq("trip_id", tripId).order("created_at"),
      ]);
      if (tripRes.error) throw tripRes.error;

      const expenses: Expense[] = expensesRes.data ?? [];
      const expenseIds = new Set(expenses.map((e) => e.id));

      const claims = new Map<string, { member_id: string; qty: number }[]>();
      for (const c of (claimsRes.data ?? []) as { receipt_item_id: string; member_id: string; qty?: number }[]) {
        const arr = claims.get(c.receipt_item_id) ?? [];
        arr.push({ member_id: c.member_id, qty: c.qty ?? 1 });
        claims.set(c.receipt_item_id, arr);
      }

      const unitsByExpense = new Map<string, PerDayUnit[]>();
      const partsByUnit = new Map<string, string[]>();
      for (const p of (unitPartsRes.data ?? []) as { unit_id: string; member_id: string }[]) {
        const arr = partsByUnit.get(p.unit_id) ?? [];
        arr.push(p.member_id);
        partsByUnit.set(p.unit_id, arr);
      }
      for (const u of (unitsRes.data ?? []) as { id: string; expense_id: string; unit_index: number; label: string }[]) {
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
      for (const s of (sharesRes.data ?? []) as { expense_id: string; member_id: string; amount_cents: number }[]) {
        if (!expenseIds.has(s.expense_id)) continue;
        const arr = simpleShares.get(s.expense_id) ?? [];
        arr.push({ member_id: s.member_id, amount_cents: s.amount_cents });
        simpleShares.set(s.expense_id, arr);
      }

      setData({
        trip: tripRes.data,
        members: membersRes.data ?? [],
        expenses,
        receiptItems: (itemsRes.data ?? []).filter((it: ReceiptItem) => expenseIds.has(it.expense_id)),
        claims,
        simpleShares,
        perDayUnits: unitsByExpense,
        payments: paymentsRes.data ?? [],
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
  items: { name: string; qty: number; price_cents: number }[];
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
  if (itemErr) throw itemErr;

  // Map client temp ids -> real ids by sort order, then insert claims.
  const rows: { receipt_item_id: string; member_id: string; qty: number }[] = [];
  (items ?? []).forEach((real: { id: string; sort: number }) => {
    const tempKey = `tmp-${real.sort}`;
    for (const c of args.claims.get(tempKey) ?? []) {
      rows.push({ receipt_item_id: real.id, member_id: c.member_id, qty: c.qty });
    }
  });
  if (rows.length > 0) {
    const { error: claimErr } = await db.from("item_claims").insert(rows);
    if (claimErr) throw claimErr;
  }
  return expense.id;
}

export async function setItemClaims(itemId: string, claims: { member_id: string; qty: number }[]) {
  const db = authedClient();
  await db.from("item_claims").delete().eq("receipt_item_id", itemId);
  if (claims.length > 0) {
    const { error } = await db.from("item_claims").insert(
      claims.map((c) => ({ receipt_item_id: itemId, member_id: c.member_id, qty: c.qty }))
    );
    if (error) throw error;
  }
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
  items: { name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by client-side temp id
}): Promise<void> {
  const db = authedClient();
  const { error: expErr } = await db.from("expenses").update({
    name: args.name, amount_cents: args.totalCents, paid_by_member_id: args.paidBy,
  }).eq("id", args.expenseId);
  if (expErr) throw expErr;

  // Deleting items cascades to their claims.
  const { error: delErr } = await db.from("receipt_items").delete().eq("expense_id", args.expenseId);
  if (delErr) throw delErr;

  const { data: items, error: itemErr } = await db.from("receipt_items").insert(
    args.items.map((it, i) => ({
      expense_id: args.expenseId, name: it.name, qty: it.qty,
      price_cents: it.price_cents, sort: i,
    }))
  ).select();
  if (itemErr) throw itemErr;

  const rows: { receipt_item_id: string; member_id: string; qty: number }[] = [];
  (items ?? []).forEach((real: { id: string; sort: number }) => {
    const tempKey = `tmp-${real.sort}`;
    for (const c of args.claims.get(tempKey) ?? []) {
      rows.push({ receipt_item_id: real.id, member_id: c.member_id, qty: c.qty });
    }
  });
  if (rows.length > 0) {
    const { error: claimErr } = await db.from("item_claims").insert(rows);
    if (claimErr) throw claimErr;
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
  if (shareErr) throw shareErr;
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
  if (unitErr) throw unitErr;

  const rows: { unit_id: string; member_id: string }[] = [];
  (unitRows ?? []).forEach((real: { id: string; unit_index: number }) => {
    for (const mid of args.units[real.unit_index].memberIds) {
      rows.push({ unit_id: real.id, member_id: mid });
    }
  });
  if (rows.length > 0) {
    const { error: partErr } = await db.from("per_day_participants").insert(rows);
    if (partErr) throw partErr;
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
