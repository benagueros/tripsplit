import { useMemo, useState } from "react";
import { centsToDollars, formatMoney } from "../lib/money";
import {
  computeShares,
  netBalances,
  simplifyDebts,
} from "../lib/settle";
import { confirmPayment, deleteExpense, recordPayment, type TripData } from "../lib/store";
import { venmoChargeLink, venmoPayLink } from "../lib/venmo";

export default function Balances({
  data,
  onBack,
  onChanged,
  onStartOwn,
}: {
  data: TripData;
  onBack: () => void;
  onChanged: () => void;
  onStartOwn: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const nameOf = (id: string) =>
    data.members.find((m) => m.id === id)?.name ?? "?";

  const shares = useMemo(
    () =>
      computeShares({
        members: data.members,
        expenses: data.expenses,
        receiptItems: data.receiptItems,
        claims: data.claims,
        simpleShares: data.simpleShares,
        perDayUnits: data.perDayUnits,
      }),
    [data]
  );
  const balances = useMemo(() => netBalances(shares), [shares]);
  const settlements = useMemo(() => simplifyDebts(balances), [balances]);

  // Payments already recorded reduce what's still owed.
  const remaining = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of settlements) {
      map.set(`${s.from_member_id}>${s.to_member_id}`, s.amount_cents);
    }
    for (const p of data.payments) {
      const key = `${p.from_member_id}>${p.to_member_id}`;
      map.set(key, Math.max(0, (map.get(key) ?? 0) - p.amount_cents));
    }
    return [...map.entries()]
      .filter(([, amt]) => amt > 0)
      .map(([key, amount_cents]) => {
        const [from_member_id, to_member_id] = key.split(">");
        return { from_member_id, to_member_id, amount_cents };
      });
  }, [settlements, data.payments]);

  const markPaid = async (from: string, to: string, amountCents: number) => {
    setError(null);
    try {
      await recordPayment({ tripId: data.trip.id, from, to, amountCents });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record that.");
    }
  };

  const confirm = async (paymentId: string) => {
    setConfirming(paymentId);
    try {
      await confirmPayment(paymentId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't confirm.");
    } finally {
      setConfirming(null);
    }
  };

  const removeExpense = async (expenseId: string, expenseName: string) => {
    if (!window.confirm(`Delete "${expenseName}"? This can't be undone.`)) return;
    try {
      await deleteExpense(expenseId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  const pendingPayments = data.payments.filter((p) => p.status === "pending");
  const confirmedPayments = data.payments.filter((p) => p.status === "confirmed");

  return (
    <>
      <div className="row">
        <button className="btn ghost small" onClick={onBack}>← Expenses</button>
      </div>
      <h1>Settle up</h1>
      {error && <div className="err">{error}</div>}

      <h2>Balances</h2>
      <div className="card">
        {shares.map((s) => {
          const bal = balances.get(s.member_id) ?? 0;
          return (
            <div className="settlerow" key={s.member_id}>
              <div className="avatar">{nameOf(s.member_id)[0]?.toUpperCase()}</div>
              <div className="grow">
                <b>{nameOf(s.member_id)}</b>
                <div className="muted">
                  had {formatMoney(s.consumed_cents)} · paid {formatMoney(s.paid_cents)}
                </div>
              </div>
              <b style={{ color: bal < 0 ? "var(--warn)" : bal > 0 ? "var(--accent)" : "var(--muted)" }}>
                {bal === 0 ? "even" : bal > 0 ? `+${formatMoney(bal)}` : formatMoney(bal)}
              </b>
            </div>
          );
        })}
      </div>

      <h2>Payments</h2>
      {remaining.length === 0 && (
        <div className="ok">Everyone's settled up. 🎉</div>
      )}
      {remaining.map((s, i) => {
        const note = `TripSplit: ${data.trip.name} — ${nameOf(s.from_member_id)} to ${nameOf(s.to_member_id)} via tripsplit.us`;
        return (
          <div className="card" key={i}>
            <div className="row between">
              <div>
                <b>{nameOf(s.from_member_id)}</b> → <b>{nameOf(s.to_member_id)}</b>
              </div>
              <div className="amt-big" style={{ fontSize: 22 }}>{formatMoney(s.amount_cents)}</div>
            </div>
            <div className="row">
              <a
                className="btn small grow"
                style={{ textDecoration: "none" }}
                href={venmoPayLink(centsToDollars(s.amount_cents), note)}
              >
                Pay in Venmo
              </a>
              <a
                className="btn secondary small grow"
                style={{ textDecoration: "none" }}
                href={venmoChargeLink(centsToDollars(s.amount_cents), note)}
              >
                Request
              </a>
            </div>
            <button className="btn ghost small" onClick={() => markPaid(s.from_member_id, s.to_member_id, s.amount_cents)}>
              ✓ Mark as paid
            </button>
          </div>
        );
      })}

      {pendingPayments.length > 0 && (
        <>
          <h2>Awaiting confirmation</h2>
          {pendingPayments.map((p) => (
            <div className="card" key={p.id}>
              <div className="row between">
                <div>
                  <b>{nameOf(p.from_member_id)}</b> → <b>{nameOf(p.to_member_id)}</b>
                  <div className="muted">{formatMoney(p.amount_cents)} · waiting on {nameOf(p.to_member_id)}</div>
                </div>
                <button
                  className="btn small"
                  disabled={confirming === p.id}
                  onClick={() => confirm(p.id)}
                >
                  {nameOf(p.to_member_id)}: got it ✓
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {confirmedPayments.length > 0 && (
        <>
          <h2>Done</h2>
          <div className="card">
            {confirmedPayments.map((p) => (
              <div className="row between" key={p.id}>
                <span>{nameOf(p.from_member_id)} → {nameOf(p.to_member_id)}</span>
                <b>{formatMoney(p.amount_cents)} ✓</b>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>All expenses</h2>
      {data.expenses.map((e) => (
        <div className="card" key={e.id}>
          <div className="row between">
            <div>
              <b>{e.name}</b>
              <div className="muted">{formatMoney(e.amount_cents)}</div>
            </div>
            <button className="btn ghost small" onClick={() => removeExpense(e.id, e.name)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card center" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 28 }}>🧳</div>
        <b>Got another trip coming up?</b>
        <div className="muted" style={{ margin: "6px 0 12px" }}>
          Start your own TripSplit — free, no signup.
        </div>
        <button className="btn" onClick={onStartOwn}>
          Start a trip
        </button>
      </div>
    </>
  );
}
