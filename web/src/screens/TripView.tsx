import { useEffect, useState } from "react";
import type { Session } from "../App";
import { getReceiptForEdit, useTripData } from "../lib/store";
import { formatMoney } from "../lib/money";
import ShareTrip from "./ShareTrip";
import ReceiptFlow, { type EditReceiptData } from "./ReceiptFlow";
import SimpleExpense from "./SimpleExpense";
import SplitByDay from "./SplitByDay";
import Balances from "./Balances";
import UpgradeCard from "./UpgradeCard";
import Logo from "../components/Logo";

type View =
  | { name: "home" }
  | { name: "share" }
  | { name: "receipt" }
  | { name: "simple" }
  | { name: "perday" }
  | { name: "balances" };

export default function TripView({
  session,
  onLeave,
}: {
  session: Session;
  onLeave: () => void;
}) {
  const [view, setView] = useState<View>({ name: "home" });
  const [showShareNudge] = useState(true);
  const [editData, setEditData] = useState<EditReceiptData | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [justUpgraded, setJustUpgraded] = useState(false);
  const { data, error, loading, reload } = useTripData(session.trip.id);

  // Polar redirects back here with ?upgraded=1 after a successful checkout.
  useEffect(() => {
    if (window.location.hash.includes("upgraded=1")) {
      setJustUpgraded(true);
      window.location.hash = window.location.hash.replace(/[?&]upgraded=1/, "");
      reload();
    }
  }, []);

  const goHome = () => {
    reload();
    setEditData(null);
    setView({ name: "home" });
  };

  const startEdit = async (expenseId: string) => {
    setEditLoading(true);
    try {
      const loaded = await getReceiptForEdit(expenseId);
      setEditData({ expenseId, ...loaded });
      setView({ name: "receipt" });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't load that receipt.");
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <div>
      <div className="topbar">
        <Logo />
        <div className="tripname grow">{session.trip.name}</div>
        <button className="btn ghost small" onClick={() => setView({ name: "share" })}>
          Share
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            if (window.confirm("Leave this trip? You can rejoin anytime with the link or code.")) {
              onLeave();
            }
          }}
          title="Leave this trip"
        >
          Leave
        </button>
      </div>

      {view.name === "share" && (
        <div className="screen">
          <ShareTrip trip={session.trip} onDone={() => setView({ name: "home" })} />
        </div>
      )}

      {view.name === "receipt" && data && (
        <div className="screen">
          <ReceiptFlow
            tripId={session.trip.id}
            members={data.members}
            onDone={goHome}
            onCancel={goHome}
            editData={editData ?? undefined}
          />
        </div>
      )}

      {view.name === "simple" && data && (
        <div className="screen">
          <SimpleExpense
            tripId={session.trip.id}
            members={data.members}
            onDone={goHome}
            onCancel={() => setView({ name: "home" })}
          />
        </div>
      )}

      {view.name === "perday" && data && (
        <div className="screen">
          <SplitByDay
            tripId={session.trip.id}
            members={data.members}
            onDone={goHome}
            onCancel={() => setView({ name: "home" })}
          />
        </div>
      )}

      {view.name === "balances" && data && (
        <div className="screen">
          <Balances
            data={data}
            onBack={() => setView({ name: "home" })}
            onChanged={reload}
          />
        </div>
      )}

      {view.name === "home" && (
        <div className="screen">
          {justUpgraded && (
            <div className="card">
              <b>🎉 You're on TripSplit Plus!</b>
              <div className="muted">200 receipt scans/month for this trip.</div>
            </div>
          )}
          {showShareNudge && (
            <div className="card">
              <div className="row between">
                <div>
                  <b>Trip's live!</b>
                  <div className="muted">Drop the link in the group chat.</div>
                </div>
                <button className="btn small" onClick={() => setView({ name: "share" })}>
                  Share
                </button>
              </div>
            </div>
          )}
          {error && <div className="err">{error}</div>}
          {loading && <p className="muted">Loading trip…</p>}
          {data && (
            <>
              <h2>Expenses</h2>
              {data.expenses.length === 0 && (
                <p className="muted">
                  Nothing yet. Scan the first receipt to get rolling.
                </p>
              )}
              {data.expenses.map((e) => {
                const payer = data.members.find((m) => m.id === e.paid_by_member_id);
                return (
                  <div className="card" key={e.id}>
                    <div className="row between">
                      <div>
                        <b>{e.name}</b>
                        <div className="muted">
                          {e.type === "receipt" ? "🧾 Receipt" : e.type === "simple" ? "💵 Split" : "🛏️ Split by day"}
                          {" · "}paid by {payer?.name ?? "?"}
                        </div>
                      </div>
                      <div className="row" style={{ alignItems: "center", gap: 8 }}>
                        <div className="amt-big" style={{ fontSize: 20 }}>
                          {formatMoney(e.amount_cents)}
                        </div>
                        {e.type === "receipt" && (
                          <button
                            className="btn ghost small"
                            disabled={editLoading}
                            onClick={() => startEdit(e.id)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="card">
                <div className="row between">
                  <div>
                    <b>{data.members.length} people</b>
                    <div className="muted">
                      {data.members.map((m) => m.name).join(", ")}
                    </div>
                  </div>
                </div>
              </div>
              <UpgradeCard tier={data.trip.tier} />
            </>
          )}
        </div>
      )}

      {view.name === "home" && data && (
        <div className="bottomnav">
          <button className="btn" onClick={() => { setEditData(null); setView({ name: "receipt" }); }}>
            🧾 Scan
          </button>
          <button className="btn secondary" onClick={() => setView({ name: "simple" })}>
            💵 Split
          </button>
          <button className="btn secondary" onClick={() => setView({ name: "perday" })}>
            🛏️ By day
          </button>
          <button className="btn secondary" onClick={() => setView({ name: "balances" })}>
            ⚖️ Settle
          </button>
        </div>
      )}
    </div>
  );
}
