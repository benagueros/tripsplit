import HeroScene from "../components/HeroScene";
import { ClaimArt, SettleArt, SnapArt } from "../components/FeatureArt";
import Icon, { type IconName } from "../components/Icon";
import Logo from "../components/Logo";

const STEPS = [
  {
    title: "Scan a receipt",
    text: "Snap the receipt — line items get pulled out automatically. You'll correct anything it misreads next.",
    Art: SnapArt,
  },
  {
    title: "Tap what you had",
    text: "Pass the phone around — or tap a line to split it between several people.",
    Art: ClaimArt,
  },
  {
    title: "Settle up",
    text: "Pay in Venmo or send a request, then mark it as paid. Everyone's settled up. 🎉",
    Art: SettleArt,
  },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "bolt", title: "AI receipt scanning", text: "Snap the receipt — line items get pulled out automatically." },
  { icon: "sparkle", title: "Automatic tax & tip splitting", text: "Tax + tip split by everyone's share. Anything unclaimed splits evenly." },
  { icon: "bed", title: "Split by night or day", text: "Airbnb, hotel — who slept there each night. Rental car — who rode along each day." },
  { icon: "coins", title: "Split an expense", text: "No receipt needed — gas, tickets, cover charges." },
  { icon: "scale", title: "Settle up with Venmo", text: "Pay in Venmo or send a request in one tap, then mark it as paid." },
  { icon: "link", title: "No accounts", text: "No account, no app download — this link is your login." },
];

const USES = ["Road trips", "Vacations", "Bachelor parties", "Bachelorette parties", "Group travel"];

export default function Landing({
  error,
  onStart,
  onJoin,
}: {
  error: string | null;
  onStart: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="landing">
      <header className="topbar wide">
        <div className="topbar-in">
          <Logo />
          <div className="grow" />
          <button className="btn secondary small" onClick={onJoin}>
            Join a trip
          </button>
        </div>
      </header>

      {error && (
        <div className="screen" style={{ paddingBottom: 0 }}>
          <div className="err">{error}</div>
        </div>
      )}

      <section className="stage hero">
        <span className="eyebrow hero-eyebrow">Split group trip expenses</span>
        <h1 className="mega">
          Snap. Claim.
          <br />
          <span className="hl">Settled.</span>
        </h1>
        <HeroScene>
          <h2>Share one link in the group chat and you're done.</h2>
          <p className="lead">
            Math handled, vibes intact. Scan receipts with AI, claim the items
            you had, and settle up with Venmo.
          </p>
          <div className="cta-row">
            <button className="btn white" style={{ width: "auto" }} onClick={onStart}>
              Start a trip
              <span className="go"><Icon name="arrowRight" /></span>
            </button>
            <button className="linkbtn" onClick={onJoin}>
              Join with a link or code <Icon name="arrowRight" size={18} />
            </button>
          </div>
          <ul className="checks">
            <li><Icon name="check" size={15} /> No app download</li>
            <li><Icon name="check" size={15} /> No accounts</li>
            <li><Icon name="check" size={15} /> No signup</li>
          </ul>
        </HeroScene>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>New to TripSplit? Here's the flow</h2>
          <p>Everyone joins from one link in their browser.</p>
        </div>
        <div className="how-grid">
          {STEPS.map(({ title, text, Art }, i) => (
            <article className="card how-card" key={title}>
              <div className="art-wrap"><Art /></div>
              <div className="step">
                <span className="num">{i + 1}</span>
                <h3>{title}</h3>
              </div>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Features</span>
          <h2>Math handled, vibes intact.</h2>
          <p>
            TripSplit is a free Splitwise alternative for splitting group trip
            expenses — with no app download, no accounts, and no signup.
          </p>
        </div>
        <div className="feat-grid">
          {FEATURES.map((f) => (
            <article className="card feat" key={f.title}>
              <span className="tile"><Icon name={f.icon} size={22} /></span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="uses" aria-label="Built for">
          {USES.map((u) => <span key={u}>{u}</span>)}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Pricing</span>
          <h2>Free, no signup.</h2>
          <p>Free up to 15 receipt scans per month. TripSplit Plus raises the limit to 200.</p>
        </div>
        <div className="price-grid">
          <article className="card price">
            <span className="eyebrow">Free</span>
            <div className="amt-big">$0</div>
            <p className="muted">15 receipt scans per month. Everything else included.</p>
          </article>
          <article className="card price plus">
            <span className="eyebrow">✨ TripSplit Plus</span>
            <div className="amt-big">$2.99<small> /mo</small></div>
            <p className="muted">200 receipt scans/month for this trip. Upgrade from inside any trip.</p>
          </article>
        </div>
      </section>

      <section className="stage final">
        <span className="eyebrow">🧳 Got a trip coming up?</span>
        <h2>Snap. Claim. Settled.</h2>
        <p>Start your own TripSplit — free, no signup.</p>
        <button className="btn white" style={{ width: "auto" }} onClick={onStart}>
          Start a trip
          <span className="go"><Icon name="arrowRight" /></span>
        </button>
      </section>

      <footer className="footer">
        <Logo />
        <span>tripsplit.us</span>
        <a href="https://iso-glow.vercel.app" target="_blank" rel="noreferrer">Made with ISO-GLOW ↗</a>
      </footer>
    </div>
  );
}
