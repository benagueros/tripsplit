import { useState } from "react";
import { tripLink } from "../lib/api";
import type { Trip } from "../lib/types";

export default function ShareTrip({
  trip,
  onDone,
}: {
  trip: Trip;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = tripLink(trip.token);
  const message = `Join "${trip.name}" on TripSplit: ${link} (backup code ${trip.code})`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <h1>Share this trip</h1>
      <p className="muted">
        One link in the group chat and everyone's in — no accounts, no sign-up.
      </p>
      <div className="linkbox">{link}</div>
      <button className="btn" onClick={() => copy(message)}>
        {copied ? "Copied! ✓" : "Copy invite message"}
      </button>
      <div className="card center">
        <div className="muted">Backup code (if the link gets lost)</div>
        <div className="bigcode">{trip.code}</div>
      </div>
      <button className="btn ghost" onClick={onDone}>
        Done
      </button>
    </>
  );
}
