import { useState } from "react";
import { dollarsToCents, formatMoney, splitCentsEvenly } from "../lib/money";
import { saveSimpleExpense } from "../lib/store";
import type { Member, SimpleSplitShare } from "../lib/types";

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
  const [paidBy, setPaidBy] = useState(members[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("equal");
  const [included, setIncluded] = useState<string[]>(members.map((m) => m.id));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleIncluded = (id: string) =>
    setIncluded((prev) =>
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
    const pcts = people.map((m) => parseFloat(percent[m.id] || "0"));
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

  return (
    <>
      <h1>Split an expense</h1>
      <p className="muted">No receipt needed — gas, tickets, cover charges.</p>
      {error && <div className="err">{error}</div>}
      <label className="field">
        What for?
        <input type="text" placeholder="Gas" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <label className="field grow">
          Amount ($)
          <input
            type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            value={amountStr} onChange={(e) => setAmountStr(e.target.value)}
          />
        </label>
        <label className="field grow">
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="tabs">
        {(["equal", "custom", "percent"] as Mode[]).map((m) => (
          <button key={m} className={`chip ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
            {m === "equal" ? "Equal" : m === "custom" ? "$ Custom" : "% Percent"}
          </button>
        ))}
      </div>
      <h2>Who's in?</h2>
      <div className="chiprow">
        {members.map((m) => (
          <button
            key={m.id}
            className={`chip ${included.includes(m.id) ? "on" : ""}`}
            onClick={() => toggleIncluded(m.id)}
          >
            {m.name}
          </button>
        ))}
      </div>
      {mode !== "equal" && inPeople.map((m) => (
        <div className="row" key={m.id}>
          <div className="grow"><b>{m.name}</b></div>
          <div style={{ width: 130 }}>
            <input
              type="number" inputMode="decimal" min="0"
              placeholder={mode === "custom" ? "$" : "%"}
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
      <button className="btn" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save expense"}
      </button>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  );
}
