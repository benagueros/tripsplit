import { useMemo, useState } from "react";
import { centsToDollars, formatMoney } from "../lib/money";
import {
  computeShares,
  netBalances,
  simplifyDebts,
} from "../lib/settle";
import { confirmPayment, deleteExpense, recordPayment, type TripData } from "../lib/store";
import { venmoChargeLink, venmoPayLink } from "../lib/venmo";
import Icon from "../components/Icon";
import { Avatar } from "../components/Person";

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
  const indexOf = (id: string) => data.members.findIndex((m) => m.id === id);
  const person = (id: string, small?: boolean) => (
    <Avatar name={nameOf(id)} index={indexOf(id)} small={small} />
  );

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

  // Per-receipt unclaimed summary: items nobody has claimed yet. Their cost
  // currently splits evenly across everyone — surface that so the group can
  // see what's still up for grabs instead of finding out by text.
  const unclaimedByExpense = useMemo(() => {
    const map = new Map<string, { count: number; total: number; cents: number }>();
    for (const e of data.expenses) {
      if (e.type !== "receipt") continue;
      const items = data.receiptItems.filter((it) => it.expense_id === e.id);
      const un = items.filter((it) => (data.claims.get(it.id) ?? []).length === 0);
      if (un.length > 0) {
        map.set(e.id, {
          count: un.length,
          total: items.length,
          cents: un.reduce((a, it) => a + it.price_cents, 0),
        });
      }
    }
    return map;
  }, [data]);

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

  const maxAbs = Math.max(1, ...[...balances.values()].map(Math.abs));

  return (
    <>
      <div className="row">
        <button className="btn ghost small" onClick={onBack}>
          <Icon name="arrowLeft" size={16} /> Expenses
        </button>
      </div>
      <div className="screen-head">
        <span className="eyebrow">Settle</span>
        <h1>Settle up</h1>
      </div>
      {error && <div className="err">{error}</div>}

      <h2>Balances</h2>
      <div className="card" style={{ gap: 0, padding: "6px 16px" }}>
        {shares.map((s) => {
          const bal = balances.get(s.member_id) ?? 0;
          const width = `${(Math.abs(bal) / maxAbs) * 50}%`;
          return (
            <div className="bal-row" key={s.member_id}>
              {person(s.member_id)}
              <div className="grow">
                <b>{nameOf(s.member_id)}</b>
                <div className="muted">
                  had {formatMoney(s.consumed_cents)} · paid {formatMoney(s.paid_cents)}
                </div>
                <div className="bal-bar">
                  {bal !== 0 && <i className={bal > 0 ? "pos" : "neg"} style={{ width }} />}
                </div>
              </div>
              <b className={`bal-amt ${bal > 0 ? "pos" : bal < 0 ? "neg" : "even"}`}>
                {bal === 0 ? "even" : bal > 0 ? `+${formatMoney(bal)}` : formatMoney(bal)}
              </b>
            </div>
          );
        })}
      </div>

      <h2>Payments</h2>
      {remaining.length === 0 && (
        <div className="card glow celebrate">
          <div className="big">🎉</div>
          <b>Everyone's settled up.</b>
        </div>
      )}
      {remaining.map((s, i) => {
        const note = `TripSplit: ${data.trip.name} — ${nameOf(s.from_member_id)} to ${nameOf(s.to_member_id)} via tripsplit.us`;
        return (
          <div className="card" key={i}>
            <div className="pay-flow">
              <div className="pay-who">
                {person(s.from_member_id)}
                <b>{nameOf(s.from_member_id)}</b>
              </div>
              <div className="pay-mid">
                <div className="amt-big">{formatMoney(s.amount_cents)}</div>
                <svg className="arrow" viewBox="0 0 92 12" fill="none" aria-hidden="true">
                  <path d="M2 6h84" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
                  <path d="m82 1.5 6 4.5-6 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="pay-who">
                {person(s.to_member_id)}
                <b>{nameOf(s.to_member_id)}</b>
              </div>
            </div>
            <div className="btnrow">
              <a className="btn small" href={venmoPayLink(centsToDollars(s.amount_cents), note)}>
                Pay in Venmo
              </a>
              <a className="btn secondary small" href={venmoChargeLink(centsToDollars(s.amount_cents), note)}>
                Request
              </a>
            </div>
            <button className="btn ghost small" style={{ width: "100%" }} onClick={() => markPaid(s.from_member_id, s.to_member_id, s.amount_cents)}>
              <Icon name="check" size={16} /> Mark as paid
            </button>
          </div>
        );
      })}

      {pendingPayments.length > 0 && (
        <>
          <h2>Awaiting confirmation</h2>
          {pendingPayments.map((p) => (
            <div className="card" key={p.id}>
              <div className="row">
                {person(p.from_member_id, true)}
                <Icon name="arrowRight" size={16} />
                {person(p.to_member_id, true)}
                <div className="grow">
                  <b>{nameOf(p.from_member_id)}</b> → <b>{nameOf(p.to_member_id)}</b>
                  <div className="muted">{formatMoney(p.amount_cents)} · waiting on {nameOf(p.to_member_id)}</div>
                </div>
              </div>
              <button
                className="btn small"
                style={{ width: "100%" }}
                disabled={confirming === p.id}
                onClick={() => confirm(p.id)}
              >
                {nameOf(p.to_member_id)}: got it ✓
              </button>
            </div>
          ))}
        </>
      )}

      {confirmedPayments.length > 0 && (
        <>
          <h2>Done</h2>
          <div className="card" style={{ gap: 4 }}>
            {confirmedPayments.map((p) => (
              <div className="done-row" key={p.id}>
                <span>{nameOf(p.from_member_id)} → {nameOf(p.to_member_id)}</span>
                <b>{formatMoney(p.amount_cents)} ✓</b>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>All expenses</h2>
      <div className="card list">
        {data.expenses.map((e) => {
          const u = unclaimedByExpense.get(e.id);
          return (
            <div className="ex-row" key={e.id} style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <b>{e.name}</b>
                <div className="muted">{formatMoney(e.amount_cents)}</div>
                {u && (
                  <div className="muted" style={{ marginTop: 4, color: "var(--warn)" }}>
                    {u.count} of {u.total} items unclaimed · {formatMoney(u.cents)} splitting evenly for now
                  </div>
                )}
              </div>
              <button className="btn ghost small" onClick={() => removeExpense(e.id, e.name)}>
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          );
        })}
      </div>

      <section className="stage celebrate" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="big">🧳</div>
        <h2>Got another trip coming up?</h2>
        <div className="muted" style={{ marginBottom: 6 }}>
          Start your own TripSplit — free, no signup.
        </div>
        <button className="btn white" style={{ width: "auto" }} onClick={onStartOwn}>
          Start a trip
          <span className="go"><Icon name="arrowRight" /></span>
        </button>
      </section>
    </>
  );
}
