import { useState } from "react";
import { dollarsToCents, formatMoney, splitCentsEvenly } from "../lib/money";
import { savePerDayExpense } from "../lib/store";
import type { Member } from "../lib/types";
import Icon from "../components/Icon";
import { PersonChip } from "../components/Person";

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
  const [paidByChoice, setPaidBy] = useState(members[0]?.id ?? "");
  // Kept as raw text so the field can be cleared and retyped freely —
  // coercing "" to a number mid-typing is what produced the "13" bug.
  const [unitCountStr, setUnitCountStr] = useState("2");
  const [units, setUnits] = useState<string[][]>([[], []]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cfg = PRESETS[preset];

  // The form can stay open (hidden) while people are removed from the trip,
  // so drop anyone who is gone before counting, showing, or saving.
  const memberIds = new Set(members.map((m) => m.id));
  const liveUnits = units.map((u) => u.filter((id) => memberIds.has(id)));
  const paidBy = memberIds.has(paidByChoice) ? paidByChoice : members[0]?.id ?? "";

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
    const emptyIdx = liveUnits.findIndex((u) => u.length === 0);
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
        units: liveUnits.map((ids, i) => ({
          label: `${cfg.unitLabel[0].toUpperCase() + cfg.unitLabel.slice(1)} ${i + 1}`,
          memberIds: ids,
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
      <div className="screen-head">
        <span className="eyebrow">By day</span>
        <h1>Split by {preset === "lodging" ? "night" : "day"}</h1>
        <p className="muted">{cfg.hint}</p>
      </div>
      {error && <div className="err">{error}</div>}
      <div className="seg" role="group" aria-label="Kind">
        {(["lodging", "rental"] as Preset[]).map((p) => (
          <button key={p} className={preset === p ? "on" : ""} aria-pressed={preset === p} onClick={() => changePreset(p)}>
            <Icon name={p === "lodging" ? "bed" : "car"} size={18} />
            {p === "lodging" ? "Lodging" : "Rental car"}
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
      <label className="field">
        Total cost ($)
        <div className="money">
          <span>$</span>
          <input
            type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            value={totalStr} onChange={(e) => setTotalStr(e.target.value)}
          />
        </div>
      </label>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field grow">
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 100, textTransform: "capitalize" }}>
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
        <p className="per-unit">
          {formatMoney(preview[0])} per {cfg.unitLabel} × {unitCount}
        </p>
      )}
      <div className="unitgrid">
        {liveUnits.map((ids, i) => (
          <div className="card unit" key={i}>
            <div className="ulabel">
              {cfg.unitLabel[0].toUpperCase() + cfg.unitLabel.slice(1)} {i + 1}
              {preview[i] != null && (
                <span>{formatMoney(preview[i])}{ids.length > 0 && ` ÷ ${ids.length}`}</span>
              )}
            </div>
            <div className="chiprow">
              {members.map((m, j) => (
                <PersonChip
                  key={m.id}
                  name={m.name}
                  index={j}
                  on={ids.includes(m.id)}
                  onClick={() => toggle(i, m.id)}
                />
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
