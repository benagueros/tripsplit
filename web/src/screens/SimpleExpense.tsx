import { useState } from "react";
import { dollarsToCents, formatMoney, splitCentsEvenly } from "../lib/money";
import { saveSimpleExpense } from "../lib/store";
import type { Member, SimpleSplitShare } from "../lib/types";
import { Avatar, PersonChip } from "../components/Person";

type Mode = "equal" | "custom" | "percent";

export default function SimpleExpense({
  tripId,
  members,
  onDone,
  onCancel,
}: {
  tripId: string;
  members: Member[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidByChoice, setPaidBy] = useState(members[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("equal");
  // Track who is left out, not who is in: the form can stay open (hidden)
  // while people are added or removed, and then a new person starts in and
  // a removed person simply drops out.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const included = members.filter((m) => !excluded.includes(m.id)).map((m) => m.id);
  // A payer removed from the trip falls back to what the select now shows.
  const paidBy = members.some((m) => m.id === paidByChoice) ? paidByChoice : members[0]?.id ?? "";

  const toggleIncluded = (id: string) =>
    setExcluded((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const resolveShares = (totalCents: number): SimpleSplitShare[] => {
    const people = members.filter((m) => included.includes(m.id));
    if (mode === "equal") {
      const splits = splitCentsEvenly(totalCents, people.length);
      return people.map((m, i) => ({ member_id: m.id, amount_cents: splits[i] }));
    }
    if (mode === "custom") {
      const shares = people.map((m) => {
        const v = custom[m.id]?.trim() || "0";
        return { member_id: m.id, amount_cents: dollarsToCents(v) };
      });
      const sum = shares.reduce((a, s) => a + s.amount_cents, 0);
      if (sum !== totalCents) {
        throw new Error(
          `Custom amounts add to ${formatMoney(sum)} but the total is ${formatMoney(totalCents)}.`
        );
      }
      return shares;
    }
    // percent
    const pcts = people.map((m) => {
      const p = parseFloat(percent[m.id] || "0");
      if (!Number.isFinite(p)) {
        throw new Error("Percents must be numbers that total 100%.");
      }
      return p;
    });
    const sumPct = pcts.reduce((a, p) => a + p, 0);
    if (Math.abs(sumPct - 100) > 0.001) {
      throw new Error(`Percents add to ${sumPct}% — they must total 100%.`);
    }
    const raw = pcts.map((p) => (totalCents * p) / 100);
    const floored = raw.map(Math.floor);
    let remainder = totalCents - floored.reduce((a, b) => a + b, 0);
    const order = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac);
    const out = [...floored];
    for (let k = 0; k < remainder; k++) out[order[k % order.length].i] += 1;
    return people.map((m, i) => ({ member_id: m.id, amount_cents: out[i] }));
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError("Name this expense (e.g. Gas)."); return; }
    let totalCents: number;
    try {
      totalCents = dollarsToCents(amountStr);
      if (totalCents <= 0) throw new Error();
    } catch {
      setError("Enter an amount greater than $0.");
      return;
    }
    if (included.length === 0) { setError("Choose who's in on this."); return; }
    let shares: SimpleSplitShare[];
    try {
      shares = resolveShares(totalCents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the split.");
      return;
    }
    setSaving(true);
    try {
      await saveSimpleExpense({ tripId, name: name.trim(), totalCents, paidBy, shares });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  };

  const inPeople = members.filter((m) => included.includes(m.id));
  // Live "each" preview for an equal split; hidden until the amount parses.
  // When the cents don't divide evenly, some people pay one cent more.
  let each: string | null = null;
  try {
    const t = dollarsToCents(amountStr || "0");
    if (mode === "equal" && t > 0 && inPeople.length > 0) {
      const splits = splitCentsEvenly(t, inPeople.length);
      const [hi, lo] = [splits[0], splits[splits.length - 1]];
      each = hi === lo ? formatMoney(hi) : `${formatMoney(lo)}–${formatMoney(hi)}`;
    }
  } catch { /* typing */ }

  return (
    <>
      <div className="screen-head">
        <span className="eyebrow">Split</span>
        <h1>Split an expense</h1>
        <p className="muted">No receipt needed — gas, tickets, cover charges.</p>
      </div>
      {error && <div className="err">{error}</div>}
      <label className="field">
        What for?
        <input type="text" placeholder="Gas" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Amount ($)
        <div className="money">
          <span>$</span>
          <input
            type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            value={amountStr} onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
      </label>
      <label className="field">
        Paid by
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>
      <div className="seg" role="group" aria-label="Split mode">
        {(["equal", "custom", "percent"] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? "on" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === "equal" ? "Equal" : m === "custom" ? "$ Custom" : "% Percent"}
          </button>
        ))}
      </div>
      <div className="section-title">
        <h2>Who's in?</h2>
        {each !== null && <span className="count">{each} each</span>}
      </div>
      <div className="chiprow">
        {members.map((m, i) => (
          <PersonChip
            key={m.id}
            name={m.name}
            index={i}
            on={included.includes(m.id)}
            onClick={() => toggleIncluded(m.id)}
          />
        ))}
      </div>
      {mode !== "equal" && inPeople.length > 0 && (
        <div className="card" style={{ gap: 10 }}>
          {inPeople.map((m) => (
            <div className="row" key={m.id}>
              <Avatar name={m.name} index={members.indexOf(m)} small />
              <div className="grow"><b>{m.name}</b></div>
              <div style={{ width: 130 }}>
                <input
                  type="number" inputMode="decimal" min="0"
                  placeholder={mode === "custom" ? "$" : "%"}
                  aria-label={`${m.name} ${mode === "custom" ? "amount" : "percent"}`}
                  value={mode === "custom" ? custom[m.id] ?? "" : percent[m.id] ?? ""}
                  onChange={(e) =>
                    mode === "custom"
                      ? setCustom({ ...custom, [m.id]: e.target.value })
                      : setPercent({ ...percent, [m.id]: e.target.value })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="btn" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save expense"}
      </button>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  );
}
