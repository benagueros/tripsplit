// Isometric drawing kernel (after iso-figure / iso-glow): +x runs down-right,
// +y down-left, +z up. Every axis projects at unit length, so a world-space
// circle of radius r becomes an ellipse with semi-axes r*K by r/√2.

const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** Screen radius of a world-space sphere; horizontal semi-axis per unit radius. */
export const K = Math.SQRT2 * C;
const KY = Math.SQRT1_2;

type V3 = [number, number, number];

export function P(x: number, y: number, z: number): [number, number] {
  return [(x - y) * C, (x + y) * S - z];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function pts(list: V3[]): string {
  return list.map(([x, y, z]) => P(x, y, z).map(r2).join(",")).join(" ");
}

function plane(o: V3, u: V3, v: V3): string {
  const [ox, oy] = P(...o);
  const du = [(u[0] - u[1]) * C, (u[0] + u[1]) * S - u[2]];
  const dv = [(v[0] - v[1]) * C, (v[0] + v[1]) * S - v[2]];
  return `matrix(${[...du, ...dv, ox, oy].map(r4).join(" ")})`;
}

/** Transforms that map flat 2D drawing onto a face plane at a world point. */
export const TOP = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
export const FRONT = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 0, -1]);
export const SIDE = (x: number, y: number, z: number) => plane([x, y, z], [0, -1, 0], [0, 0, -1]);

/** SIDE-plane card centred on a screen point, scaled by s (for animation). */
export function sideCard(x: number, y: number, s = 1): string {
  return `matrix(${r4(C * s)} ${r4(-S * s)} 0 ${r4(s)} ${r2(x)} ${r2(y)})`;
}

export function Box({
  x, y, z, w, d, h, className,
}: { x: number; y: number; z: number; w: number; d: number; h: number; className?: string }) {
  return (
    <g className={className}>
      <polygon className="i-front" points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} />
      <polygon className="i-side" points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} />
      <polygon className="i-top" points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} />
    </g>
  );
}

/** Rounded slab (a platform): rounded top, one continuous wall below it. */
export function Slab({
  x, y, z, w, d, h, r,
}: { x: number; y: number; z: number; w: number; d: number; h: number; r: number }) {
  const q = r - r / Math.SQRT2;
  // Leftmost and rightmost silhouette points sit on two corner arcs.
  const L = (zz: number) => P(x + q, y + d - q, zz);
  const R = (zz: number) => P(x + w - q, y + q, zz);
  const [lt, lb, rt, rb] = [L(z + h), L(z), R(z + h), R(z)];
  const quad = [lt, rt, rb, lb].map((p) => p.map(r2).join(",")).join(" ");
  return (
    <g>
      <rect className="i-front" transform={TOP(x, y, z)} width={w} height={d} rx={r} />
      <polygon className="i-front i-nostroke" points={quad} />
      <line className="i-edge" x1={lt[0]} y1={lt[1]} x2={lb[0]} y2={lb[1]} />
      <line className="i-edge" x1={rt[0]} y1={rt[1]} x2={rb[0]} y2={rb[1]} />
      <rect className="i-top" transform={TOP(x, y, z + h)} width={w} height={d} rx={r} />
    </g>
  );
}

/** Upright cylinder; topClass styles the lid (e.g. a glowing pot). */
export function Cylinder({
  x, y, z, r, h, className, topClass = "i-top",
}: { x: number; y: number; z: number; r: number; h: number; className?: string; topClass?: string }) {
  const [tx, ty] = P(x, y, z + h);
  const [bx, by] = P(x, y, z);
  const a = r * K;
  const b = r * KY;
  return (
    <g className={className}>
      <path
        className="i-front"
        d={`M${tx - a},${ty} L${bx - a},${by} A${a},${b} 0 0 0 ${bx + a},${by} L${tx + a},${ty} Z`}
      />
      <ellipse className={topClass} cx={tx} cy={ty} rx={a} ry={b} />
    </g>
  );
}

export type Extra = "bun" | "cap" | "shades" | "curls";

/**
 * A soft, round person: gumdrop body, big head, small face that looks
 * toward `look` (-1 left … 1 right). Colours come from a .tone-N class.
 */
export function Person({
  x, y, tone, look = 0, extra,
}: { x: number; y: number; tone: number; look?: number; extra?: Extra }) {
  const bodyH = 30;
  const rb = 12.5;
  const rt = 9.5;
  const [fx, fy] = P(x, y, 0);
  const [tx, ty] = P(x, y, bodyH);
  const [ab, bb, at, bt] = [rb * K, rb * KY, rt * K, rt * KY];
  const [hx, hy] = P(x, y, bodyH + 11);
  const hr = 12.5 * K;
  const cx = hx + look * hr * 0.32;
  const ey = hy + hr * 0.04;
  const hairCap = `M${hx - hr * 0.99},${hy - hr * 0.08} A${hr},${hr} 0 0 1 ${hx + hr * 0.99},${hy - hr * 0.08} C${hx + hr * 0.45},${hy - hr * 0.5} ${hx - hr * 0.45},${hy - hr * 0.5} ${hx - hr * 0.99},${hy - hr * 0.08} Z`;

  return (
    <g className={`person tone-${tone}`}>
      <ellipse className="p-shadow" cx={fx} cy={fy} rx={ab * 1.3} ry={bb * 1.3} />
      <g className="p-all">
        <path className="p-body" d={`M${tx - at},${ty} L${fx - ab},${fy} A${ab},${bb} 0 0 0 ${fx + ab},${fy} L${tx + at},${ty} Z`} />
        <path
          className="p-shade"
          d={`M${tx},${ty + bt} L${fx},${fy + bb} A${ab},${bb} 0 0 0 ${fx + ab},${fy} L${tx + at},${ty} A${at},${bt} 0 0 1 ${tx},${ty + bt} Z`}
        />
        <ellipse className="p-top" cx={tx} cy={ty} rx={at} ry={bt} />
        <circle className="p-head" cx={hx} cy={hy} r={hr} />
        <path className="p-shade" d={`M${hx},${hy - hr} A${hr},${hr} 0 0 1 ${hx},${hy + hr} A${hr * 0.62},${hr} 0 0 0 ${hx},${hy - hr} Z`} />
        <circle className="p-hl" cx={hx - hr * 0.4} cy={hy - hr * 0.42} r={hr * 0.24} />
        <circle className="p-cheek" cx={cx - hr * 0.52} cy={ey + hr * 0.3} r={hr * 0.15} />
        <circle className="p-cheek" cx={cx + hr * 0.52} cy={ey + hr * 0.3} r={hr * 0.15} />
        <circle className="p-eye" cx={cx - hr * 0.28} cy={ey} r={hr * 0.11} />
        <circle className="p-eye" cx={cx + hr * 0.28} cy={ey} r={hr * 0.11} />
        <path className="p-smile" d={`M${cx - hr * 0.2},${ey + hr * 0.26} Q${cx},${ey + hr * 0.46} ${cx + hr * 0.2},${ey + hr * 0.26}`} />
        {extra === "bun" && (
          <>
            <path className="p-hair" d={hairCap} />
            <circle className="p-hair" cx={hx - look * hr * 0.3} cy={hy - hr * 1.02} r={hr * 0.4} />
          </>
        )}
        {extra === "curls" && (
          <>
            <path className="p-hair" d={hairCap} />
            {[-0.62, -0.22, 0.2, 0.6].map((k) => (
              <circle key={k} className="p-hair" cx={hx + k * hr} cy={hy - hr * (0.78 + 0.12 * (1 - Math.abs(k)))} r={hr * 0.3} />
            ))}
          </>
        )}
        {extra === "cap" && (
          <>
            <path className="p-cap" d={`M${hx - hr},${hy - hr * 0.12} A${hr},${hr} 0 0 1 ${hx + hr},${hy - hr * 0.12} Z`} />
            <ellipse className="p-cap" cx={hx + look * hr * 0.62} cy={hy - hr * 0.14} rx={hr * 0.72} ry={hr * 0.2} />
          </>
        )}
        {extra === "shades" && (
          <>
            <rect className="p-shades" x={cx - hr * 0.6} y={ey - hr * 0.17} width={hr * 0.52} height={hr * 0.34} rx={hr * 0.12} />
            <rect className="p-shades" x={cx + hr * 0.08} y={ey - hr * 0.17} width={hr * 0.52} height={hr * 0.34} rx={hr * 0.12} />
            <path className="p-bridge" d={`M${cx - hr * 0.08},${ey - hr * 0.06} L${cx + hr * 0.08},${ey - hr * 0.06}`} />
          </>
        )}
      </g>
    </g>
  );
}
