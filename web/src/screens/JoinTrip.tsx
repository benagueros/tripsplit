import { useState } from "react";
import Icon from "../components/Icon";

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
      <div className="screen-head">
        <span className="eyebrow">Join</span>
        <h1>Join a trip</h1>
        <p className="muted">
          Paste the link from the group chat, or type the short code (like{" "}
          <b style={{ color: "var(--ink)" }}>CANYON-482193</b>).
        </p>
      </div>
      {error && <div className="err">{error}</div>}
      <input
        type="text"
        placeholder="Trip link or code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button className="btn" disabled={joining} onClick={submit}>
        {joining ? "Joining…" : <>Join trip <Icon name="arrowRight" size={18} /></>}
      </button>
      <div className="info" style={{ marginTop: 10 }}>
        <Icon name="sparkle" size={18} />
        <span>
          New to TripSplit? It splits group expenses with no app download and no
          signup — the link is all you need.
        </span>
      </div>
      <button className="btn ghost" onClick={onBack}>Back</button>
    </>
  );
}
