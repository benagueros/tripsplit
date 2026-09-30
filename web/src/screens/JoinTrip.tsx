import { useState } from "react";

export default function JoinTrip({
  onBack,
  onJoin,
}: {
  onBack: () => void;
  onJoin: (tokenOrCode: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const submit = async () => {
    setError(null);
    if (!value.trim()) { setError("Paste the trip link or enter the code."); return; }
    // Accept a full link — pull the token out of it.
    const m = value.trim().match(/\/t\/([A-Za-z0-9\-_]+)/);
    const tokenOrCode = m ? m[1] : value.trim();
    setJoining(true);
    try {
      await onJoin(tokenOrCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that trip.");
      setJoining(false);
    }
  };

  return (
    <>
      <h1>Join a trip</h1>
      <p className="muted">
        Paste the link from the group chat, or type the short code (like{" "}
        <b>CANYON-4821</b>).
      </p>
      {error && <div className="err">{error}</div>}
      <input
        type="text"
        placeholder="Trip link or code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button className="btn" disabled={joining} onClick={submit}>
        {joining ? "Joining…" : "Join trip"}
      </button>
      <button className="btn ghost" onClick={onBack}>Back</button>
    </>
  );
}
