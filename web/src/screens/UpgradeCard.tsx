import { useEffect, useState } from "react";
import { functionsUrl, getTripJwt } from "../lib/supabase";
import { startPlusCheckout } from "../lib/plus";
import Icon from "../components/Icon";

type SubState = {
  cancel_at_period_end: boolean;
  current_period_end: string | null;
};

async function callPolarCancel(action: "status" | "cancel" | "resume") {
  const res = await fetch(functionsUrl("polar-cancel"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getTripJwt()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  const data = (await res.json()) as SubState & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't update the subscription.");
  return data as SubState;
}

/** Upgrade prompt on free trips; cancel/resume controls on paid trips. */
export default function UpgradeCard({ tier }: { tier: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sub, setSub] = useState<SubState | null>(null);

  useEffect(() => {
    if (tier !== "paid") return;
    callPolarCancel("status").then(setSub).catch(() => {});
  }, [tier]);

  if (tier !== "paid") {
    const startCheckout = async () => {
      setBusy(true);
      setError(null);
      try {
        await startPlusCheckout();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start checkout.");
        setBusy(false);
      }
    };

    return (
      <div className="card glow">
        <div className="row">
          <span className="tile"><Icon name="sparkle" size={22} /></span>
          <div className="grow">
            <b>TripSplit Plus</b>
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

  const onCancelToggle = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await callPolarCancel(sub?.cancel_at_period_end ? "resume" : "cancel");
      setSub(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the subscription.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const ends = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="card glow">
      <div className="row">
        <span className="tile"><Icon name="sparkle" size={22} /></span>
        <div className="grow">
          <b>TripSplit Plus</b>
          <div className="muted">
            {sub?.cancel_at_period_end
              ? ends
                ? `Ends ${ends} — won't renew.`
                : "Cancels at the end of the billing period."
              : "200 receipt scans/month · $2.99/mo."}
          </div>
        </div>
        <button
          className="btn small secondary"
          disabled={busy}
          onClick={onCancelToggle}
          onBlur={() => setConfirming(false)}
        >
          {busy
            ? "…"
            : confirming
              ? "Tap again to confirm"
              : sub?.cancel_at_period_end
                ? "Keep Plus"
                : "Cancel"}
        </button>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  );
}
