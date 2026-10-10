// Dev-only sample trip, opened with #/demo (see main.tsx). It feeds fixed
// data into TripView so every trip screen can be seen with no backend.
// Saves and scans fail with their normal error messages here.
import TripView from "../screens/TripView";
import type { TripData } from "../lib/store";
import type { Expense, Member, ReceiptItem } from "../lib/types";

const at = "2026-10-01T12:00:00Z";
const trip = { id: "demo-trip", token: "demo", code: "CANYON-482193", name: "Big Bend weekend", tier: "free" as const, created_at: at };
const member = (id: string, name: string): Member => ({ id, trip_id: trip.id, name, created_at: at });
const members = [member("m1", "Maya"), member("m2", "Jordan"), member("m3", "Sam"), member("m4", "Alex")];

const expense = (id: string, type: Expense["type"], name: string, amount_cents: number, paid_by_member_id: string): Expense => ({
  id, trip_id: trip.id, type, name, amount_cents, paid_by_member_id, meta: {}, created_at: at,
});
const item = (id: string, name: string, qty: number, price_cents: number, sort: number): ReceiptItem => ({
  id, expense_id: "e1", name, qty, price_cents, sort,
});

const DEMO: TripData = {
  trip,
  members,
  expenses: [
    expense("e1", "receipt", "Franklin BBQ", 12260, "m1"),
    expense("e2", "simple", "Gas", 6400, "m2"),
    expense("e3", "per_day", "The Airbnb", 48000, "m3"),
  ],
  receiptItems: [
    item("i1", "Brisket (1 lb)", 1, 3200, 0),
    item("i2", "Pork ribs", 1, 2600, 1),
    item("i3", "Mac & cheese", 2, 1198, 2),
    item("i4", "Banana pudding", 1, 650, 3),
    item("i5", "Lone Star", 4, 2400, 4),
  ],
  claims: new Map([
    ["i1", [{ member_id: "m1", qty: 1 }, { member_id: "m2", qty: 1 }]],
    ["i2", [{ member_id: "m3", qty: 1 }]],
    ["i3", [{ member_id: "m1", qty: 1 }, { member_id: "m4", qty: 1 }]],
    ["i5", members.map((m) => ({ member_id: m.id, qty: 1 }))],
  ]),
  simpleShares: new Map([["e2", members.map((m) => ({ member_id: m.id, amount_cents: 1600 }))]]),
  perDayUnits: new Map([
    ["e3", [
      { id: "u1", expense_id: "e3", unit_index: 0, label: "Night 1", member_ids: ["m1", "m2", "m3", "m4"] },
      { id: "u2", expense_id: "e3", unit_index: 1, label: "Night 2", member_ids: ["m1", "m2", "m3", "m4"] },
      { id: "u3", expense_id: "e3", unit_index: 2, label: "Night 3", member_ids: ["m1", "m3", "m4"] },
    ]],
  ]),
  payments: [
    { id: "p1", trip_id: trip.id, from_member_id: "m4", to_member_id: "m3", amount_cents: 2500, status: "pending", created_at: at },
    { id: "p2", trip_id: trip.id, from_member_id: "m2", to_member_id: "m3", amount_cents: 1000, status: "confirmed", created_at: at },
  ],
};

const leave = () => {
  window.location.hash = "";
  window.location.reload();
};

export default function DemoTrip() {
  return (
    <TripView
      session={{ trip, members }}
      demo={DEMO}
      onLeave={leave}
      onStartNewTrip={leave}
    />
  );
}
