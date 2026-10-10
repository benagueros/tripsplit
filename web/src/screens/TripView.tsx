import { useEffect, useState } from "react";
import type { Session } from "../App";
import { addMember, getReceiptForEdit, removeMember, useTripData, type TripData } from "../lib/store";
import { formatMoney } from "../lib/money";
import ShareTrip from "./ShareTrip";
import ReceiptFlow, { type EditReceiptData } from "./ReceiptFlow";
import SimpleExpense from "./SimpleExpense";
import SplitByDay from "./SplitByDay";
import Balances from "./Balances";
import UpgradeCard from "./UpgradeCard";
import InstallPrompt from "../components/InstallPrompt";
import Logo from "../components/Logo";
import Icon, { type IconName } from "../components/Icon";
import { Avatar } from "../components/Person";
import { SnapArt } from "../components/FeatureArt";
import type { ExpenseType } from "../lib/types";

const EXPENSE_KIND: Record<ExpenseType, { label: string; icon: IconName; tone: string }> = {
  receipt: { label: "Receipt", icon: "receipt", tone: "tone-5" },
  simple: { label: "Split", icon: "coins", tone: "tone-3" },
  per_day: { label: "Split by day", icon: "bed", tone: "tone-2" },
};

type View = "home" | "share" | "receipt" | "edit" | "simple" | "perday" | "balances";
/** Views with a draft that must survive a tab switch until save or cancel.
 *  "receipt" is a new scan; "edit" is an existing receipt — separate forms,
 *  so opening one never wipes the other's draft. */
type FormView = "receipt" | "edit" | "simple" | "perday";
const FORMS: View[] = ["receipt", "edit", "simple", "perday"];
const isForm = (v: View): v is FormView => FORMS.includes(v);

const TABS: { view: View; label: string; icon: IconName }[] = [
  { view: "home", label: "Trip", icon: "home" },
  { view: "simple", label: "Split", icon: "coins" },
  { view: "receipt", label: "Scan", icon: "camera" },
  { view: "perday", label: "By day", icon: "bed" },
  { view: "balances", label: "Settle", icon: "scale" },
];

export default function TripView({
  session,
  onLeave,
  onStartNewTrip,
  demo,
}: {
  session: Session;
  onLeave: () => void;
  onStartNewTrip: () => void;
  /** Dev-only sample data (see dev/DemoTrip); skips the network. */
  demo?: TripData;
}) {
  const [view, setView] = useState<View>("home");
  const [openForms, setOpenForms] = useState<FormView[]>([]);
  const [showShareNudge, setShowShareNudge] = useState(true);
  const [editData, setEditData] = useState<EditReceiptData | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [justUpgraded, setJustUpgraded] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  // First-visit hint, once per trip per device. The viral loop brings people
  // who have never seen the app — a two-line explainer converts exposure
  // into comprehension.
  const [showHowto, setShowHowto] = useState(() => {
    try {
      return !localStorage.getItem(`tripsplit_howto_${session.trip.id}`);
    } catch {
      return false;
    }
  });
  const dismissHowto = () => {
    setShowHowto(false);
    try {
      localStorage.setItem(`tripsplit_howto_${session.trip.id}`, "1");
    } catch {
      /* private mode — hint just shows again next visit */
    }
  };
  const live = useTripData(demo ? null : session.trip.id);
  const { error, reload } = live;
  const data = demo ?? live.data;
  const loading = !demo && live.loading;
  const people = data?.members ?? session.members;
  const totalCents = data?.expenses.reduce((a, e) => a + e.amount_cents, 0) ?? 0;

  // Each view starts at the top, not at the last scroll position.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Polar redirects back here with ?upgraded=1 after a successful checkout.
  useEffect(() => {
    if (window.location.hash.includes("upgraded=1")) {
      setJustUpgraded(true);
      window.location.hash = window.location.hash.replace(/[?&]upgraded=1/, "");
      reload();
    }
  }, []);

  // Switching tabs only hides an open form, so a half-done receipt (or a
  // scan in flight) is still there on return. Save or cancel closes it.
  const show = (v: View) => {
    if (isForm(v)) setOpenForms((f) => (f.includes(v) ? f : [...f, v]));
    setView(v);
  };

  const closeForm = (form: FormView, saved: boolean) => {
    setOpenForms((f) => f.filter((x) => x !== form));
    if (form === "edit") setEditData(null);
    if (saved) reload();
    // A save can finish after the user moved to another tab; stay there.
    setView((v) => (v === form ? "home" : v));
  };

  const startEdit = async (expenseId: string) => {
    if (openForms.includes("edit") && editData) {
      // Same receipt: go back to the open draft, don't reload over it.
      if (editData.expenseId === expenseId) {
        show("edit");
        return;
      }
      if (!window.confirm("Discard your unsaved changes to the receipt you were editing?")) return;
    }
    setEditLoading(true);
    try {
      const loaded = await getReceiptForEdit(expenseId);
      setEditData({ expenseId, ...loaded });
      show("edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't load that receipt.");
    } finally {
      setEditLoading(false);
    }
  };

  const doAddMember = async () => {
    setMemberError(null);
    if (!newMemberName.trim()) {
      setMemberError("Enter a name.");
      return;
    }
    setMemberBusy(true);
    try {
      await addMember(session.trip.id, newMemberName);
      setNewMemberName("");
      setAddingMember(false);
      reload();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : "Couldn't add them.");
    } finally {
      setMemberBusy(false);
    }
  };

  const doRemoveMember = async (id: string, name: string) => {
    setMemberError(null);
    if (!window.confirm(`Remove ${name} from this trip?`)) return;
    setMemberBusy(true);
    try {
      await removeMember(id);
      reload();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : "Couldn't remove them.");
    } finally {
      setMemberBusy(false);
    }
  };

  return (
    <div>
      <header className="topbar">
        <div className="topbar-in">
          <Logo compact />
          <div className="tripname grow">{session.trip.name}</div>
          <button className="btn secondary small" onClick={() => setView("share")}>
            <Icon name="share" size={16} /> Share
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
            <Icon name="logout" size={16} /> Leave
          </button>
        </div>
      </header>

      {view === "share" && (
        <div className="screen">
          <ShareTrip trip={session.trip} onDone={() => setView("home")} />
        </div>
      )}

      {data && openForms.includes("receipt") && (
        <div className="screen" hidden={view !== "receipt"}>
          <ReceiptFlow
            tripId={session.trip.id}
            members={data.members}
            onDone={() => closeForm("receipt", true)}
            onCancel={() => closeForm("receipt", false)}
          />
        </div>
      )}

      {data && editData && openForms.includes("edit") && (
        <div className="screen" hidden={view !== "edit"}>
          <ReceiptFlow
            key={editData.expenseId}
            tripId={session.trip.id}
            members={data.members}
            onDone={() => closeForm("edit", true)}
            onCancel={() => closeForm("edit", false)}
            editData={editData}
          />
        </div>
      )}

      {data && openForms.includes("simple") && (
        <div className="screen" hidden={view !== "simple"}>
          <SimpleExpense
            tripId={session.trip.id}
            members={data.members}
            onDone={() => closeForm("simple", true)}
            onCancel={() => closeForm("simple", false)}
          />
        </div>
      )}

      {data && openForms.includes("perday") && (
        <div className="screen" hidden={view !== "perday"}>
          <SplitByDay
            tripId={session.trip.id}
            members={data.members}
            onDone={() => closeForm("perday", true)}
            onCancel={() => closeForm("perday", false)}
          />
        </div>
      )}

      {view === "balances" && data && (
        <div className="screen">
          <Balances
            data={data}
            onBack={() => setView("home")}
            onChanged={reload}
            onStartOwn={onStartNewTrip}
          />
        </div>
      )}

      {view === "home" && (
        <div className="screen">
          {justUpgraded && (
            <div className="card glow celebrate">
              <div className="big">🎉</div>
              <b>You're on TripSplit Plus!</b>
              <div className="muted">200 receipt scans/month for this trip.</div>
            </div>
          )}

          <section className="stage trip-hero">
            <h1>{session.trip.name}</h1>
            <div className="stats">
              <div>
                <small>Total</small>
                <div className="amt-big">{formatMoney(totalCents)}</div>
              </div>
              <div className="avatar-stack" role="img" aria-label={`${people.length} people`}>
                {people.slice(0, 5).map((m, i) => (
                  <Avatar key={m.id} name={m.name} index={i} />
                ))}
                {people.length > 5 && <span className="avatar more">+{people.length - 5}</span>}
              </div>
            </div>
            {showShareNudge && (
              <div className="nudge">
                <div className="grow">
                  <b>Trip's live!</b>
                  <span>Drop the link in the group chat.</span>
                </div>
                <button className="btn small" onClick={() => setView("share")}>
                  Share
                </button>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => setShowShareNudge(false)}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            )}
          </section>

          {showHowto && (
            <div className="card glow">
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <b>👋 New to TripSplit? Here's the flow</b>
                <button className="btn ghost small" onClick={dismissHowto}>
                  Got it
                </button>
              </div>
              <div className="howto-steps">
                <span><i>1</i>Scan a receipt</span>
                <span><i>2</i>Tap what you had</span>
                <span><i>3</i>Settle up</span>
              </div>
              <div className="muted">No account, no app download — this link is your login.</div>
            </div>
          )}
          <InstallPrompt />
          {error && <div className="err">{error}</div>}
          {loading && <p className="muted">Loading trip…</p>}
          {data && (
            <>
              <div className="section-title">
                <h2>Expenses</h2>
                {data.expenses.length > 0 && <span className="count">{data.expenses.length}</span>}
              </div>
              {data.expenses.length === 0 ? (
                <div className="card empty">
                  <SnapArt />
                  <p className="muted">Nothing yet. Scan the first receipt to get rolling.</p>
                </div>
              ) : (
                <div className="card list">
                  {data.expenses.map((e) => {
                    const payer = data.members.find((m) => m.id === e.paid_by_member_id);
                    const kind = EXPENSE_KIND[e.type] ?? EXPENSE_KIND.receipt;
                    return (
                      <div className="ex-row" key={e.id}>
                        <span className={`tile receipt ${kind.tone}`}>
                          <Icon name={kind.icon} size={21} />
                        </span>
                        <div className="grow">
                          <b>{e.name}</b>
                          <div className="muted">
                            {kind.label} · paid by {payer?.name ?? "?"}
                          </div>
                        </div>
                        <div className="ex-amt">{formatMoney(e.amount_cents)}</div>
                        {e.type === "receipt" && (
                          <button
                            className="icon-btn"
                            disabled={editLoading}
                            onClick={() => startEdit(e.id)}
                            aria-label={`Edit ${e.name}`}
                            title="Edit"
                          >
                            <Icon name="edit" size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="card">
                <div className="row between">
                  <h3>{data.members.length} people</h3>
                  <button
                    className="btn ghost small"
                    disabled={memberBusy}
                    onClick={() => {
                      setMemberError(null);
                      setAddingMember((v) => !v);
                    }}
                  >
                    {addingMember ? "Cancel" : <><Icon name="plus" size={16} /> Add</>}
                  </button>
                </div>
                {data.members.length > 0 && (
                  <div className="pills">
                    {data.members.map((m, i) => (
                      <span key={m.id} className="pill">
                        <Avatar name={m.name} index={i} small />
                        {m.name}
                        <button
                          className="pill-x"
                          disabled={memberBusy}
                          aria-label={`Remove ${m.name}`}
                          onClick={() => doRemoveMember(m.id, m.name)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {addingMember && (
                  <div className="row">
                    <input
                      type="text"
                      className="grow"
                      placeholder="Name (e.g. Maya)"
                      maxLength={40}
                      value={newMemberName}
                      disabled={memberBusy}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doAddMember();
                      }}
                    />
                    <button className="btn small" disabled={memberBusy} onClick={doAddMember}>
                      Add
                    </button>
                  </div>
                )}
                {memberError && <div className="err">{memberError}</div>}
              </div>
              <UpgradeCard tier={data.trip.tier} />
            </>
          )}
        </div>
      )}

      {data && (
        <nav className="dock" aria-label="Trip sections">
          {TABS.map((t) => (
            <button
              key={t.view}
              className={`${t.view === "receipt" ? "primary" : ""}${view === t.view ? " on" : ""}`}
              aria-current={view === t.view ? "page" : undefined}
              onClick={() => show(t.view)}
            >
              <Icon name={t.icon} size={22} />
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
