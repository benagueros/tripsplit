import { useState } from "react";
import { functionsUrl, getTripJwt } from "../lib/supabase";

/** Shown on free-tier trips. Starts a Polar checkout for TripSplit Plus. */
export default function UpgradeCard({ tier }: { tier: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tier === "paid") return null;

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(functionsUrl("polar-checkout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getTripJwt()}` },
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't start checkout.");
      if (!data.url) throw new Error("Checkout URL missing.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row between">
        <div>
          <b>✨ TripSplit Plus</b>
          <div className="muted">
            200 receipt scans/month · $2.99/mo. Free tier includes 15.
          </div>
        </div>
        <button className="btn small" disabled={busy} onClick={startCheckout}>
          {busy ? "…" : "Upgrade"}
        </button>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  );
}
