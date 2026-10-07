import { useState } from "react";
import { dollarsToCents, formatMoney, splitCentsEvenly } from "../lib/money";
import { savePerDayExpense } from "../lib/store";
import type { Member } from "../lib/types";

type Preset = "lodging" | "rental";

const PRESETS: Record<Preset, { unitLabel: string; unitLabelPlural: string; hint: string }> = {
  lodging: { unitLabel: "night", unitLabelPlural: "nights", hint: "Airbnb, hotel — who slept there each night." },
  rental: { unitLabel: "day", unitLabelPlural: "days", hint: "Rental car — who rode along each day." },
};

export default function SplitByDay({
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
  const [preset, setPreset] = useState<Preset>("lodging");
  const [name, setName] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [paidBy, setPaidBy] = useState(members[0]?.id ?? "");
  // Kept as raw text so the field can be cleared and retyped freely —
  // coercing "" to a number mid-typing is what produced the "13" bug.
  const [unitCountStr, setUnitCountStr] = useState("2");
  const [units, setUnits] = useState<string[][]>([[], []]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cfg = PRESETS[preset];

  // The effective count: clamped when the text parses, otherwise the
  // actual number of rows (so clearing the field doesn't collapse them).
  const parsedCount = parseInt(unitCountStr, 10);
  const unitCount = Number.isFinite(parsedCount)
    ? Math.max(1, Math.min(31, parsedCount))
    : units.length;

  const changePreset = (p: Preset) => {
    setPreset(p);
    // keep counts, just relabel
  };

  // Resize the per-night/day rows on valid input; invalid/empty input
  // leaves existing rows untouched so typing is never clobbered.
  const commitCount = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const c = Math.max(1, Math.min(31, n));
    setUnits((prev) => {
      const next = [...prev];
      while (next.length < c) next.push([]);
      return next.slice(0, c);
    });
  };

  const normalizeCount = () => {
    // On blur, snap the text to the actual row count if it's empty/invalid.
    const n = parseInt(unitCountStr, 10);
    setUnitCountStr(
      String(Number.isFinite(n) ? Math.max(1, Math.min(31, n)) : units.length)
    );
  };

  const toggle = (unitIdx: number, memberId: string) =>
    setUnits((prev) => {
      const next = prev.map((arr) => [...arr]);
      const cur = next[unitIdx];
      next[unitIdx] = cur.includes(memberId)
        ? cur.filter((id) => id !== memberId)
        : [...cur, memberId];
      return next;
    });

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError(`Name this ${preset === "lodging" ? "stay" : "rental"} (e.g. The Airbnb).`); return; }
    let totalCents: number;
    try {
      totalCents = dollarsToCents(totalStr);
      if (totalCents <= 0) throw new Error();
    } catch {
      setError("Enter the total cost.");
      return;
    }
    const emptyIdx = units.findIndex((u) => u.length === 0);
    if (emptyIdx >= 0) {
      setError(
        `${cfg.unitLabel[0].toUpperCase() + cfg.unitLabel.slice(1)} ${emptyIdx + 1} has nobody in it — ` +
        `every ${cfg.unitLabel} needs at least one person, or the math wouldn't be fair.`
      );
      return;
    }
    setSaving(true);
    try {
      await savePerDayExpense({
        tripId,
        name: name.trim(),
        totalCents,
        paidBy,
        unitLabel: cfg.unitLabel,
        preset,
        units: units.map((memberIds, i) => ({
          label: `${cfg.unitLabel[0].toUpperCase() + cfg.unitLabel.slice(1)} ${i + 1}`,
          memberIds,
        })),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  };

  let preview: number[] = [];
  try {
    const t = dollarsToCents(totalStr || "0");
    if (t > 0) preview = splitCentsEvenly(t, unitCount);
  } catch { /* typing */ }

  return (
    <>
      <h1>Split by {preset === "lodging" ? "night" : "day"}</h1>
      <p className="muted">{cfg.hint}</p>
      {error && <div className="err">{error}</div>}
      <div className="tabs">
        {(["lodging", "rental"] as Preset[]).map((p) => (
          <button key={p} className={`chip ${preset === p ? "on" : ""}`} onClick={() => changePreset(p)}>
            {p === "lodging" ? "🛏️ Lodging" : "🚗 Rental car"}
          </button>
        ))}
      </div>
      <label className="field">
        {preset === "lodging" ? "Place" : "Rental"}
        <input
          type="text"
          placeholder={preset === "lodging" ? "The Airbnb" : "Hertz SUV"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="row">
        <label className="field grow">
          Total cost ($)
          <input
            type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            value={totalStr} onChange={(e) => setTotalStr(e.target.value)}
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
        <label className="field" style={{ width: 90 }}>
          {cfg.unitLabelPlural}
          <input
            type="number" min="1" max="31" value={unitCountStr}
            onChange={(e) => {
              setUnitCountStr(e.target.value);
              commitCount(e.target.value);
            }}
            onBlur={normalizeCount}
          />
        </label>
      </div>
      {preview.length > 0 && (
        <p className="muted center">
          {formatMoney(preview[0])} per {cfg.unitLabel} × {unitCount}
        </p>
      )}
      <div className="unitgrid">
        {units.map((memberIds, i) => (
          <div className="unit" key={i}>
            <div className="ulabel">
              {cfg.unitLabel[0].toUpperCase() + cfg.unitLabel.slice(1)} {i + 1}
              {preview[i] != null && (
                <span className="muted"> · {formatMoney(preview[i])}{memberIds.length > 0 && ` ÷ ${memberIds.length}`}</span>
              )}
            </div>
            <div className="chiprow">
              {members.map((m) => (
                <button
                  key={m.id}
                  className={`chip ${memberIds.includes(m.id) ? "on" : ""}`}
                  onClick={() => toggle(i, m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button className="btn" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  );
}
