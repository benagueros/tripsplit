// Domain types. All money is integer cents — never floats.

export type ExpenseType = "receipt" | "simple" | "per_day";

export interface Trip {
  id: string;
  token: string;
  code: string;
  name: string;
  tier: "free" | "paid";
  created_at: string;
}

export interface Member {
  id: string;
  trip_id: string;
  name: string;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  type: ExpenseType;
  name: string;
  amount_cents: number;
  paid_by_member_id: string;
  /** per_day config: { unit_count, unit_label, preset } */
  meta: Record<string, unknown>;
  created_at: string;
}

export interface ReceiptItem {
  id: string;
  expense_id: string;
  name: string;
  qty: number;
  price_cents: number;
  sort: number;
}

export interface PerDayUnit {
  id: string;
  expense_id: string;
  unit_index: number;
  label: string;
  member_ids: string[];
}

export interface SimpleSplitShare {
  member_id: string;
  amount_cents: number;
}

export interface Payment {
  id: string;
  trip_id: string;
  from_member_id: string;
  to_member_id: string;
  amount_cents: number;
  status: "pending" | "confirmed";
  created_at: string;
}

export interface OcrLineItem {
  name: string;
  qty: number;
  price_cents: number;
}

export interface OcrResult {
  items: OcrLineItem[];
  merchant_name?: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  total_cents: number | null;
}
