import { splitCentsByWeight, splitCentsEvenly } from "./money";
import type {
  Expense,
  Member,
  PerDayUnit,
  ReceiptItem,
  SimpleSplitShare,
} from "./types";

export interface PersonShare {
  member_id: string;
  /** What this person consumed / was assigned, in cents. */
  consumed_cents: number;
  /** What this person paid out of pocket, in cents. */
  paid_cents: number;
}

export interface Settlement {
  from_member_id: string;
  to_member_id: string;
  amount_cents: number;
}

/**
 * Compute per-person consumed + paid for a set of expenses.
 *
 * - receipt: each line's total splits among its claimants proportionally to
 *   their claimed qty (default 1 each = even split); tax+tip (total − items
 *   subtotal) splits proportionally to claimed subtotals; any unclaimed
 *   remainder of the items subtotal splits evenly across all members.
 * - simple: uses the stored per-member resolved shares.
 * - per_day: total ÷ units; each unit splits only among that unit's participants.
 */
export function computeShares(args: {
  members: Member[];
  expenses: Expense[];
  receiptItems: ReceiptItem[];
  /** receipt_item_id -> claims[] (with per-person qty) */
  claims: Map<string, { member_id: string; qty: number }[]>;
  /** expense_id -> shares[] (simple expenses only) */
  simpleShares: Map<string, SimpleSplitShare[]>;
  /** expense_id -> units[] (per_day expenses only) */
  perDayUnits: Map<string, PerDayUnit[]>;
}): PersonShare[] {
  const { members, expenses, receiptItems, claims, simpleShares, perDayUnits } =
    args;
  const consumed = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const m of members) {
    consumed.set(m.id, 0);
    paid.set(m.id, 0);
  }
  const addConsumed = (id: string, cents: number) =>
    consumed.set(id, (consumed.get(id) ?? 0) + cents);

  for (const e of expenses) {
    paid.set(e.paid_by_member_id, (paid.get(e.paid_by_member_id) ?? 0) + e.amount_cents);

    if (e.type === "simple") {
      for (const s of simpleShares.get(e.id) ?? []) addConsumed(s.member_id, s.amount_cents);
      continue;
    }

    if (e.type === "per_day") {
      const units = perDayUnits.get(e.id) ?? [];
      const unitCount = units.length;
      if (unitCount === 0) continue;
      const perUnit = splitCentsEvenly(e.amount_cents, unitCount);
      units.forEach((u, i) => {
        if (u.member_ids.length === 0) return; // blocked at save time; guard anyway
        const shares = splitCentsEvenly(perUnit[i], u.member_ids.length);
        u.member_ids.forEach((mid, k) => addConsumed(mid, shares[k]));
      });
      continue;
    }

    // receipt
    const items = receiptItems.filter((it) => it.expense_id === e.id);
    const memberSubtotals = new Map<string, number>();
    let claimedTotal = 0;
    for (const it of items) {
      // price_cents is the LINE TOTAL as returned by OCR (qty × unit price),
      // so it must not be multiplied by qty again.
      const lineTotal = it.price_cents;
      const assignees = claims.get(it.id) ?? [];
      if (assignees.length === 0) continue; // handled as unclaimed below
      // Proportional split by claimed qty (default 1 each = even split).
      const weights = assignees.map((c) => (c.qty > 0 ? c.qty : 1));
      const shares = splitCentsByWeight(lineTotal, weights);
      assignees.forEach((c, k) => {
        memberSubtotals.set(c.member_id, (memberSubtotals.get(c.member_id) ?? 0) + shares[k]);
        claimedTotal += shares[k];
      });
    }
    const itemsSubtotal = items.reduce((a, it) => a + it.price_cents, 0);
    const unclaimed = itemsSubtotal - claimedTotal;
    if (unclaimed > 0 && members.length > 0) {
      const shares = splitCentsEvenly(unclaimed, members.length);
      members.forEach((m, k) =>
        memberSubtotals.set(m.id, (memberSubtotals.get(m.id) ?? 0) + shares[k])
      );
    }
    // Tax + tip = whatever is left of the receipt total, split by claimed weight.
    const taxTip = e.amount_cents - itemsSubtotal;
    if (taxTip > 0) {
      const ids = [...memberSubtotals.keys()];
      const weights = ids.map((id) => memberSubtotals.get(id) ?? 0);
      const shares = splitCentsByWeight(taxTip, weights);
      ids.forEach((id, k) =>
        memberSubtotals.set(id, (memberSubtotals.get(id) ?? 0) + shares[k])
      );
    }
    for (const [mid, cents] of memberSubtotals) addConsumed(mid, cents);
  }

  return members.map((m) => ({
    member_id: m.id,
    consumed_cents: consumed.get(m.id) ?? 0,
    paid_cents: paid.get(m.id) ?? 0,
  }));
}

/** Net balances: positive = is owed money, negative = owes money. */
export function netBalances(shares: PersonShare[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shares) out.set(s.member_id, s.paid_cents - s.consumed_cents);
  return out;
}

/**
 * Greedy debt simplification: repeatedly match the biggest debtor with the
 * biggest creditor. Produces the minimal number of payments for exact amounts.
 */
export function simplifyDebts(balances: Map<string, number>): Settlement[] {
  const debtors = [...balances.entries()]
    .filter(([, b]) => b < 0)
    .map(([id, b]) => ({ id, amt: -b }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = [...balances.entries()]
    .filter(([, b]) => b > 0)
    .map(([id, b]) => ({ id, amt: b }))
    .sort((a, b) => b.amt - a.amt);

  const out: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const pay = Math.min(d.amt, c.amt);
    if (pay > 0)
      out.push({ from_member_id: d.id, to_member_id: c.id, amount_cents: pay });
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt === 0) i++;
    if (c.amt === 0) j++;
  }
  return out;
}
