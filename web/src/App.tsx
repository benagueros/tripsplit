import { useCallback, useEffect, useState } from "react";
import { createTrip, getSavedTripToken, joinTrip } from "./lib/api";
import { forgetTrip } from "./lib/api";
import type { Member, Trip } from "./lib/types";
import CreateTrip from "./screens/CreateTrip";
import JoinTrip from "./screens/JoinTrip";
import TripView from "./screens/TripView";
import Logo from "./components/Logo";

export interface Session {
  trip: Trip;
  members: Member[];
}

type LandingMode = "choose" | "create" | "join";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [landing, setLanding] = useState<LandingMode>("choose");
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBooting(true);
    setError(null);
    try {
      // Link joins look like #/t/<token> (hash form is canonical).
      // Also accept the older /t/<token> path form in case one was shared.
      const hash = window.location.hash;
      const linkMatch =
        hash.match(/^#\/t\/([A-Za-z0-9\-_]+)/) ||
        window.location.pathname.match(/^\/t\/([A-Za-z0-9\-_]+)/);
      if (linkMatch) {
        const s = await joinTrip(linkMatch[1]);
        setSession({ trip: s.trip, members: s.members });
        window.location.hash = "#/";
        // Clear a path-form link so a refresh doesn't re-trigger the join.
        if (!hash.match(/^#\/t\//)) {
          window.history.replaceState(null, "", "/");
        }
        return;
      }
      const saved = getSavedTripToken();
      if (saved) {
        try {
          const s = await joinTrip(saved);
          setSession({ trip: s.trip, members: s.members });
          return;
        } catch {
          forgetTrip(); // stale token — fall through to landing
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that trip link.");
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const handleCreate = async (name: string, memberNames: string[]) => {
    const s = await createTrip(name, memberNames);
    setSession({ trip: s.trip, members: s.members });
  };

  const handleJoin = async (tokenOrCode: string) => {
    const s = await joinTrip(tokenOrCode);
    setSession({ trip: s.trip, members: s.members });
  };

  const handleLeave = () => {
    forgetTrip();
    setSession(null);
    setLanding("choose");
  };

  if (booting) {
    return (
      <div className="screen center" style={{ paddingTop: 80 }}>
        <div className="logo" style={{ fontSize: 32, fontWeight: 800 }}>
          Trip<span style={{ color: "var(--accent)" }}>Split</span>
        </div>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (session) {
    return <TripView session={session} onLeave={handleLeave} />;
  }

  return (
    <div>
      <div className="topbar">
        <Logo />
      </div>
      <div className="screen">
        {error && <div className="err">{error}</div>}
        {landing === "choose" && (
          <>
            <h1>Split the trip, not the friendship.</h1>
            <p className="muted">
              Scan receipts, claim what you had, and settle up with Venmo. No
              accounts — share one link in the group chat and you're done.
            </p>
            <button className="btn" onClick={() => setLanding("create")}>
              Start a trip
            </button>
            <button className="btn secondary" onClick={() => setLanding("join")}>
              Join with a link or code
            </button>
          </>
        )}
        {landing === "create" && (
          <CreateTrip
            onBack={() => setLanding("choose")}
            onCreate={handleCreate}
          />
        )}
        {landing === "join" && (
          <JoinTrip onBack={() => setLanding("choose")} onJoin={handleJoin} />
        )}
      </div>
    </div>
  );
}
