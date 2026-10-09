import { useId, type CSSProperties, type ReactNode } from "react";
import { Box, FRONT, P, Person, Slab, TOP } from "./iso";

// Small looping isometric vignettes for Snap / Claim / Settled. All motion
// is CSS (see .art in styles.css), so reduced-motion turns it off.

function zigzagBottom(w: number, h: number, tooth = 8): string {
  let d = `M0,0 H${w} V${h - 4}`;
  for (let x = w, up = false; x > 0; x -= tooth / 2, up = !up) d += ` L${x - tooth / 2},${up ? h - 4 : h}`;
  return `${d} Z`;
}

function Art({ vb, label, children }: { vb: [number, number, number, number]; label: string; children: (glow: string) => ReactNode }) {
  const glow = `art-glow-${useId().replace(/:/g, "")}`;
  const [x, y, w, h] = vb;
  return (
    <svg className="iso art" viewBox={vb.join(" ")} role="img" aria-label={label}>
      <defs>
        <filter id={glow} filterUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Slab x={0} y={0} z={-8} w={150} d={120} h={8} r={16} />
      {children(`url(#${glow})`)}
    </svg>
  );
}

/** A receipt under a sweeping scan beam; the phone fills in line by line. */
export function SnapArt() {
  return (
    <Art vb={[-112, -18, 250, 168]} label="A phone scans a receipt and reads its line items.">
      {(glow) => (
        <>
          <g transform={TOP(14, 22, 0.4)}>
            <path className="i-paper" d={zigzagBottom(56, 84)} />
            <path className="paper-ink" d="M8,10 H34" />
            {[24, 34, 44, 54].map((y) => (
              <path key={y} className="paper-line" d={`M8,${y} H30 M40,${y} H48`} />
            ))}
            <path className="paper-ink" d="M8,68 H22 M36,68 H48" />
            <g className="scan-beam">
              <rect className="beam-trail" x={-4} y={-14} width={64} height={14} />
              <rect className="beam" x={-4} y={-1.2} width={64} height={2.4} filter={glow} />
            </g>
          </g>
          <Box x={86} y={58} z={0} w={40} d={7} h={74} />
          <g transform={FRONT(86, 65, 74)}>
            <rect className="phone-glass" x={3} y={6} width={34} height={62} rx={4} />
            {[0, 1, 2, 3].map((i) => (
              <path
                key={i}
                className="scan-row"
                style={{ animationDelay: `${i * 0.35}s` }}
                d={`M8,${18 + i * 10} H22 M27,${18 + i * 10} H32`}
              />
            ))}
            <path className="scan-row total" d="M8,60 H32" filter={glow} />
          </g>
        </>
      )}
    </Art>
  );
}

/** Three friends tap the lines they had; one line gets split two ways. */
export function ClaimArt() {
  const rows: { y: number; tones: number[] }[] = [
    { y: 14, tones: [1] },
    { y: 30, tones: [2] },
    { y: 46, tones: [1, 3] },
    { y: 62, tones: [3] },
  ];
  return (
    <Art vb={[-112, -48, 250, 198]} label="Three friends claim the receipt lines they had.">
      {() => (
        <>
          <Person x={38} y={12} tone={1} look={0.3} extra="bun" />
          <Person x={74} y={12} tone={2} look={0} extra="cap" />
          <Person x={110} y={12} tone={3} look={-0.3} extra="shades" />
          <g transform={TOP(30, 34, 0.4)}>
            <path className="i-paper" d={zigzagBottom(80, 78)} />
            {rows.map((r, i) => (
              <g key={r.y}>
                <rect
                  className={`claim-hl tone-${r.tones[0]}`}
                  style={{ animationDelay: `${0.4 + i * 0.6}s` }}
                  x={3} y={r.y - 7} width={74} height={14} rx={3}
                />
                <circle className="claim-slot" cx={10} cy={r.y} r={5} />
                <path className="paper-line" d={`M20,${r.y} H52 M62,${r.y} H72`} />
                {r.tones.map((t, j) => (
                  <circle
                    key={t}
                    className={`claim-dot tone-${t}`}
                    style={{ animationDelay: `${0.4 + i * 0.6 + j * 0.15}s` }}
                    cx={r.tones.length > 1 ? 7 + j * 6 : 10}
                    cy={r.y}
                    r={r.tones.length > 1 ? 3.6 : 5}
                  />
                ))}
              </g>
            ))}
          </g>
        </>
      )}
    </Art>
  );
}

/** A coin hops from one friend to the other; a check lights up. */
export function SettleArt() {
  const [ax, ay] = P(30, 90, 34);
  const [bx, by] = P(115, 25, 34);
  const [cx, cy] = P(115, 25, 82);
  const coinVars = { "--dx": `${(bx - ax).toFixed(1)}px`, "--dy": `${(by - ay).toFixed(1)}px` } as CSSProperties;
  return (
    <Art vb={[-112, -64, 250, 214]} label="One friend pays another, and the payment gets a check mark.">
      {(glow) => (
        <>
          <g transform={TOP(0, 0, 0.3)}>
            <path className="i-dash" d="M30,90 L115,25" />
          </g>
          <Person x={30} y={90} tone={2} look={0.6} extra="cap" />
          <g className="settle-hop">
            <Person x={115} y={25} tone={3} look={-0.6} extra="shades" />
          </g>
          <g className="coin-o" transform={`translate(${ax.toFixed(1)} ${ay.toFixed(1)})`} style={coinVars}>
            <g className="coin-x">
              <g className="coin-y">
                <circle className="coin" r={9} filter={glow} />
                <text className="coin-t" x={0} y={4}>$</text>
                <text className="coin-amt" x={13} y={4}>$32</text>
              </g>
            </g>
          </g>
          <g transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)})`}>
            <g className="badge">
              <circle className="badge-c" r={11} filter={glow} />
              <path className="badge-t" d="M-5,0 l3.5,3.8 l6.5,-7.5" />
            </g>
          </g>
        </>
      )}
    </Art>
  );
}
