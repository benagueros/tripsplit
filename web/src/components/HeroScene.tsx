import { useEffect, useId, useRef, type ReactNode } from "react";
import { Box, Cylinder, FRONT, K, P, Person, Slab, TOP, sideCard, type Extra } from "./iso";

// Four friends stand in a circle around the pot. Their bills fly in and
// merge into one trip total, which splits into equal shares that fly back.
// Then the debts settle as coins between them.
const PEOPLE: { name: string; paid: number; tone: number; x: number; y: number; look: number; extra: Extra }[] = [
  { name: "Maya", paid: 96, tone: 1, x: -100, y: 0, look: 0.6, extra: "bun" },
  { name: "Jordan", paid: 48, tone: 2, x: 0, y: -100, look: -0.6, extra: "cap" },
  { name: "Sam", paid: 120, tone: 3, x: 0, y: 100, look: 0.5, extra: "shades" },
  { name: "Alex", paid: 56, tone: 4, x: 100, y: 0, look: -0.5, extra: "curls" },
];
const TOTAL = PEOPLE.reduce((a, p) => a + p.paid, 0);
const SHARE = TOTAL / PEOPLE.length;
/** [from, to, dollars] — the fewest payments that zero every balance. */
const PAYMENTS: [number, number, number][] = [[1, 2, 32], [3, 2, 8], [3, 0, 16]];

const HOME = PEOPLE.map((p) => P(p.x, p.y, 84));
const CHEST = PEOPLE.map((p) => P(p.x, p.y, 38));
const POT = P(0, 0, 66);

// Timeline, in seconds.
const LOOP = 10.5;
const T_FLY = 1.5;
const FLY = 0.8;
const T_TOTAL = 2.9;
const T_SPLIT = 4.3;
const T_PAY = 5.9;
const T_DONE = 7.5;
const T_FADE = 9.6;

const RAIL = [
  { k: "Snap", s: "receipts in" },
  { k: "Claim", s: "shares out" },
  { k: "Settled", s: "all square" },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const back = (v: number) => 1 + 2.7 * Math.pow(v - 1, 3) + 1.7 * Math.pow(v - 1, 2);

function zigzagCard(w: number, h: number, tooth = 8): string {
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -h / 2, h / 2];
  let d = `M${x0},${y0} H${x1} V${y1 - 4}`;
  for (let x = x1, up = false; x > x0; x -= tooth / 2, up = !up) {
    d += ` L${x - tooth / 2},${up ? y1 - 4 : y1}`;
  }
  return `${d} Z`;
}

function hop(el: Element) {
  el.classList.remove("hop");
  void el.getBoundingClientRect(); // restart the CSS animation
  el.classList.add("hop");
}

/** The hero's animated scene. `children` is the hero copy: it shares a grid
 *  with the scene and sits above the live stat card. */
export default function HeroScene({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const glow = `glow-${uid}`;
  const bloom = `bloom-${uid}`;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const all = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
    const one = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
    const people = all<SVGGElement>("[data-person]");
    const paid = all<SVGGElement>("[data-paid]");
    const shares = all<SVGGElement>("[data-share]");
    const coins = all<SVGGElement>("[data-coin]");
    const rings = all<SVGCircleElement>("[data-ring]");
    const status = all<SVGTextElement>("[data-status]");
    const rail = all<HTMLLIElement>("[data-rail]");
    const receipt = one<SVGGElement>("[data-receipt]");
    const lid = one<SVGGElement>("[data-lid]");
    const halo = one<SVGEllipseElement>("[data-halo]");
    const phone = one<SVGRectElement>("[data-phone]");
    const stat = {
      total: one<HTMLElement>('[data-stat="total"]'),
      share: one<HTMLElement>('[data-stat="share"]'),
      pays: one<HTMLElement>('[data-stat="pays"]'),
      bar: one<HTMLElement>('[data-stat="bar"]'),
    };

    // Only touch the DOM when a value changes.
    const memo = new WeakMap<Element, Map<string, string>>();
    const set = (el: Element, attr: string, v: string) => {
      let m = memo.get(el);
      if (!m) memo.set(el, (m = new Map()));
      if (m.get(attr) === v) return;
      m.set(attr, v);
      if (attr === "text") el.textContent = v;
      else if (attr === "class") el.setAttribute("class", v);
      else if (attr === "width") (el as HTMLElement).style.width = v;
      else el.setAttribute(attr, v);
    };
    const place = (el: Element, transform: string, opacity: number) => {
      set(el, "transform", transform);
      set(el, "opacity", opacity.toFixed(2));
    };

    let last = -1;
    const draw = (t: number) => {
      if (t < last) last = -1; // the loop wrapped
      const fade = 1 - clamp01((t - T_FADE) / 0.5);

      // 1 · Snap — each bill pops in over its owner, then flies to the pot.
      let collected = 0;
      PEOPLE.forEach((p, i) => {
        const tIn = 0.25 + i * 0.12;
        const t0 = T_FLY + i * 0.16;
        const [hx, hy] = HOME[i];
        let [x, y, s, o] = [hx, hy + Math.sin(t * 2.4 + i) * 1.6, 0.001, 0];
        if (t >= tIn && t < t0) {
          s = Math.max(0.001, back(clamp01((t - tIn) / 0.45)));
          o = 1;
        } else if (t >= t0) {
          const k = clamp01((t - t0) / FLY);
          const e = ease(k);
          x = lerp(hx, POT[0], e);
          y = lerp(hy, POT[1], e) - 46 * Math.sin(Math.PI * e);
          s = 1 - 0.5 * e;
          o = k < 1 ? 1 : 0;
          if (k >= 1) collected += p.paid;
        }
        place(paid[i], sideCard(x, y, s), o);
      });
      set(lid, "opacity", ((0.15 + 0.85 * (collected / TOTAL)) * fade).toFixed(2));

      // 2 · Claim — one trip total rises from the pot and splits four ways.
      const rise = clamp01((t - T_TOTAL) / 0.5);
      const split = clamp01((t - T_SPLIT) / 0.3);
      const rs = t < T_TOTAL ? 0 : back(rise) * (1 - split);
      place(receipt, sideCard(POT[0], POT[1] - 10 + (1 - rise) * 18, Math.max(rs, 0.001)), rs > 0.02 ? 1 : 0);
      set(halo, "opacity", (clamp01(rs) * 0.9).toFixed(2));

      PEOPLE.forEach((_, i) => {
        const t0 = T_SPLIT + 0.1 + i * 0.1;
        const k = clamp01((t - t0) / 0.75);
        const e = ease(k);
        const [hx, hy] = HOME[i];
        const x = lerp(POT[0], hx, e);
        let y = lerp(POT[1] - 10, hy, e) - 40 * Math.sin(Math.PI * e);
        if (k >= 1) y += Math.sin(t * 2.4 + i) * 1.6;
        place(shares[i], sideCard(x, y, 0.45 + 0.4 * e), t < t0 ? 0 : fade);
        if (last < t0 + 0.75 && t >= t0 + 0.75) hop(people[i]);
      });

      // 3 · Settled — debts travel as coins, then every ring lights up.
      let landed = 0;
      PAYMENTS.forEach(([from, to], k) => {
        const t0 = T_PAY + k * 0.35;
        const kk = clamp01((t - t0) / 0.7);
        const e = ease(kk);
        const x = lerp(CHEST[from][0], CHEST[to][0], e);
        const y = lerp(CHEST[from][1], CHEST[to][1], e) - 58 * Math.sin(Math.PI * e);
        place(coins[k], `translate(${x.toFixed(1)} ${y.toFixed(1)})`, t >= t0 && kk < 1 ? 1 : 0);
        if (kk >= 1) landed++;
        if (last < t0 + 0.7 && t >= t0 + 0.7) hop(people[to]);
      });
      rings.forEach((r, i) => set(r, "opacity", (clamp01((t - T_DONE - i * 0.08) / 0.3) * fade).toFixed(2)));
      set(phone, "class", t >= T_DONE && fade > 0.5 ? "phone-glass hot" : "phone-glass");
      if (last < T_DONE && t >= T_DONE) people.forEach(hop);

      PEOPLE.forEach((p, i) => {
        const net = p.paid - SHARE;
        let [txt, cls] = [`paid $${p.paid}`, ""];
        if (t >= T_DONE) [txt, cls] = ["settled ✓", "ok"];
        else if (t >= T_PAY) [txt, cls] = net >= 0 ? [`gets $${net}`, "gets"] : [`owes $${-net}`, "owes"];
        else if (t >= T_SPLIT + 0.95 + i * 0.1) txt = `share $${SHARE}`;
        set(status[i], "text", txt);
        set(status[i], "class", `tag-status ${cls}`);
      });

      const phase = t < T_SPLIT ? 0 : t < T_PAY ? 1 : 2;
      rail.forEach((li, i) => set(li, "class", i < phase ? "done" : i === phase ? "on" : ""));
      set(stat.total, "text", `$${collected}`);
      set(stat.share, "text", t >= T_SPLIT + 0.3 ? `$${SHARE}` : "—");
      set(stat.pays, "text", `${landed}/${PAYMENTS.length}`);
      set(stat.bar, "width", `${(landed / PAYMENTS.length) * 100}%`);
      last = t;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      last = T_DONE + 0.6;
      draw(T_DONE + 0.6);
      return;
    }

    // Run only while the scene is on screen.
    let raf = 0;
    let clock = 0;
    let prev = 0;
    const tick = (now: number) => {
      clock = (clock + Math.min(0.05, (now - prev) / 1000)) % LOOP;
      prev = now;
      draw(clock);
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !raf) {
        prev = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(root);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const VB = { x: -230, y: -164, w: 460, h: 312 };
  const filterBox = { filterUnits: "userSpaceOnUse" as const, x: VB.x, y: VB.y, width: VB.w, height: VB.h };
  const [backPeople, frontPeople] = [PEOPLE.slice(0, 2), PEOPLE.slice(2)];
  const renderPerson = (p: (typeof PEOPLE)[number]) => (
    <g key={p.name} className="p-wrap" data-person onClick={(e) => hop(e.currentTarget)}>
      <Person x={p.x} y={p.y} tone={p.tone} look={p.look} extra={p.extra} />
    </g>
  );

  return (
    <div className="hero-grid" ref={rootRef}>
      <div className="hero-copy">
        {children}
        <div className="scene-stat" aria-hidden="true">
          <div className="stat-top">
            <span>Live trip · simulated</span>
            <i className="live-dot" />
          </div>
          <div className="stat-row">
            <div>
              <div className="stat-label">Trip total</div>
              <div className="stat-big" data-stat="total">$0</div>
            </div>
            <div className="stat-grid">
              <div><span>Each share</span><b data-stat="share">—</b></div>
              <div><span>Payments</span><b data-stat="pays">0/{PAYMENTS.length}</b></div>
            </div>
          </div>
          <div className="stat-bar"><i data-stat="bar" /></div>
        </div>
      </div>
      <div className="scene">
        <svg
          className="iso"
          viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
          role="img"
          aria-label="Four friends stand in a circle. Their bills go into the middle, combine into one trip total, and come back to each of them as an equal share. Tap a person to make them hop."
        >
          <defs>
            <filter id={glow} {...filterBox}>
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={bloom} {...filterBox}>
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>

          <Slab x={-125} y={-125} z={-10} w={250} d={250} h={10} r={30} />
          <g transform={TOP(-125, -125, 0)}>
            {[50, 75, 100, 125, 150, 175, 200].map((v) => (
              <path key={v} className="i-detail" d={`M${v},12 V238 M12,${v} H238`} />
            ))}
            <circle className="i-dash" cx={125} cy={125} r={100} />
          </g>
          {PEOPLE.map((p) => (
            <circle key={p.name} data-ring className="ring" transform={TOP(p.x, p.y, 0.3)} r={19} opacity={0} filter={`url(#${glow})`} />
          ))}

          {/* phone, back corner: lights up once everyone is settled */}
          <Box x={-104} y={-112} z={0} w={28} d={4} h={50} />
          <g transform={FRONT(-104, -108, 50)}>
            <rect data-phone className="phone-glass" x={2.5} y={4} width={23} height={42} rx={3} />
            <path className="phone-check" d="M8,25 l4,4.5 l8,-10" />
            <path className="phone-line" d="M7,36 H21 M7,40 H16" />
          </g>

          {backPeople.map(renderPerson)}

          {/* the pot */}
          <ellipse data-halo className="halo" cx={POT[0]} cy={POT[1] + 4} rx={78} ry={58} opacity={0} filter={`url(#${bloom})`} />
          <Cylinder x={0} y={0} z={0} r={24} h={14} />
          <g data-lid opacity={0.15}>
            <ellipse className="pot-lid" cx={P(0, 0, 14)[0]} cy={P(0, 0, 14)[1]} rx={24 * K} ry={24 * Math.SQRT1_2} filter={`url(#${glow})`} />
          </g>
          <ellipse className="pot-inner" cx={P(0, 0, 14)[0]} cy={P(0, 0, 14)[1]} rx={15 * K} ry={15 * Math.SQRT1_2} />

          {frontPeople.map(renderPerson)}

          {/* suitcase, front corner */}
          <Box x={92} y={98} z={0} w={28} d={16} h={32} />
          <g transform={FRONT(92, 114, 32)}>
            <path className="i-strap" d="M8,2 V30 M20,2 V30" />
          </g>
          <g transform={TOP(92, 98, 32)}>
            <rect className="i-handle" x={9} y={5} width={10} height={6} rx={2.5} />
          </g>

          {/* everything in the air */}
          {PEOPLE.map((p) => (
            <g key={p.name} data-paid opacity={0}>
              <rect className="bill-paper" x={-23} y={-15} width={46} height={30} rx={4} />
              <path className="bill-line" d="M-16,-8.5 H-5" />
              <text className="bill-amt" x={0} y={7}>${p.paid}</text>
            </g>
          ))}
          <g data-receipt opacity={0}>
            <path className="bill-paper total" d={zigzagCard(68, 76)} filter={`url(#${glow})`} />
            <text className="bill-kicker" x={0} y={-20}>TRIP TOTAL</text>
            <text className="bill-big" x={0} y={4}>${TOTAL}</text>
            <path className="bill-line" d="M-22,14 H22 M-22,21 H8" />
          </g>
          {PEOPLE.map((p) => (
            <g key={p.name} data-share opacity={0}>
              <rect className="note" x={-22} y={-13} width={44} height={26} rx={4} filter={`url(#${glow})`} />
              <text className="note-amt" x={0} y={6}>${SHARE}</text>
            </g>
          ))}
          {PAYMENTS.map(([, , amt], k) => (
            <g key={k} data-coin opacity={0}>
              <circle className="coin" r={10} filter={`url(#${glow})`} />
              <text className="coin-t" x={0} y={4.5}>$</text>
              <text className="coin-amt" x={15} y={4.5}>${amt}</text>
            </g>
          ))}

          {/* name tags sit outside the circle, joined by a leader line */}
          {PEOPLE.map((p) => {
            const [fx, fy] = P(p.x, p.y, 0);
            const side = Math.sign(p.x - p.y);
            const [x, y] = [fx + side * 66, fy - 14];
            return (
              <g key={p.name}>
                <path className="tag-lead" d={`M${(fx + side * 19).toFixed(1)},${y.toFixed(1)} H${(x - side * 38).toFixed(1)}`} />
                <circle className="tag-dot" cx={fx + side * 19} cy={y} r={2} />
                <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
                  <rect className="tag" x={-38} y={-15} width={76} height={30} rx={10} />
                  <text className="tag-name" x={0} y={-2.5}>{p.name}</text>
                  <text data-status className="tag-status" x={0} y={9.5}>paid ${p.paid}</text>
                </g>
              </g>
            );
          })}
        </svg>

        <ol className="scene-rail" aria-hidden="true">
          {RAIL.map((r, i) => (
            <li key={r.k} data-rail className={i === 0 ? "on" : ""}>
              <b>{r.k}</b>
              <span>{r.s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
