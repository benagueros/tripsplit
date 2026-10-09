import { useState } from "react";

export default function CreateTrip({
  onBack,
  onCreate,
}: {
  onBack: () => void;
  onCreate: (name: string, memberNames: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [names, setNames] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setNameAt = (i: number, v: string) => {
    const next = [...names];
    next[i] = v;
    setNames(next);
  };

  const submit = async () => {
    setError(null);
    const clean = names.map((n) => n.trim().normalize("NFC")).filter(Boolean);
    if (!name.trim()) { setError("Give the trip a name."); return; }
    if (clean.length < 2) { setError("Add at least two people."); return; }
    if (clean.some((n) => n.length > 40)) { setError("Keep names to 40 characters or less."); return; }
    const lowered = clean.map((n) => n.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      setError("Names must be unique — add a last name or initial to tell duplicates apart.");
      return;
    }
    setSaving(true);
    try {
      await onCreate(name.trim(), clean);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the trip.");
      setSaving(false);
    }
  };

  return (
    <>
      <h1>New trip</h1>
      {error && <div className="err">{error}</div>}
      <label className="field">
        Trip name
        <input
          type="text"
          placeholder="Big Bend weekend"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <h2>Who's going?</h2>
      {names.map((n, i) => (
        <div className="row" key={i}>
          <input
            type="text"
            placeholder={`Person ${i + 1}`}
            value={n}
            maxLength={40}
            onChange={(e) => setNameAt(i, e.target.value)}
          />
          {names.length > 2 && (
            <button
              className="btn ghost small"
              onClick={() => setNames(names.filter((_, j) => j !== i))}
              aria-label="Remove person"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button className="btn ghost" onClick={() => setNames([...names, ""])}>
        + Add person
      </button>
      <button className="btn" disabled={saving} onClick={submit}>
        {saving ? "Creating…" : "Create trip"}
      </button>
      <button className="btn ghost" onClick={onBack}>Back</button>
    </>
  );
}
