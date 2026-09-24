/**
 * Feature prioritization + continuous-trajectory planning.
 *
 * A real Etch A Sketch cannot lift its stylus, so after contours are scored
 * and trimmed we order them into one long trajectory: greedy nearest-neighbour
 * chaining of polyline endpoints (with orientation flipping and a turn-angle
 * penalty), followed by a bounded 2-opt flip pass. Travels between features
 * remain visible — the faint moves of an attentive hand, not invisible hops.
 */
import type { EtchPolyline, EtchPlan } from './types';

export interface Scored {
  xs: number[];
  ys: number[];
  closed: boolean;
  strength: number;
  /** kind: 'edge' contour or 'hatch' tone stroke */
  kind: 'edge' | 'hatch';
}

/** score = structure * contrast * meaningfulness */
export function scoreContour(c: Scored, w: number, h: number): number {
  let len = 0;
  for (let i = 1; i < c.xs.length; i++) len += Math.hypot(c.xs[i] - c.xs[i - 1], c.ys[i] - c.ys[i - 1]);
  const diag = Math.hypot(w, h);
  let area = 0;
  if (c.closed) {
    for (let i = 0; i < c.xs.length; i++) {
      const j = (i + 1) % c.xs.length;
      area += c.xs[i] * c.ys[j] - c.xs[j] * c.ys[i];
    }
    area = Math.abs(area / 2);
  }
  const lenScore = Math.sqrt(len / diag) * 1.4; // sqrt damps detail explosion
  const areaScore = Math.sqrt(area) / diag * 1.1;
  const contrast = Math.min(1.6, c.strength * 3.5 + 0.55);
  const kindBonus = c.kind === 'hatch' ? 0.42 : 1;
  return (lenScore + areaScore) * contrast * kindBonus;
}

/**
 * Order scored contours into a single continuous pen path.
 * Returns EtchPolylines in normalized [0,1] coordinates (aspect-corrected to
 * the drawable rectangle), with explicit travel segments marked faint.
 */
export function planTrajectory(
  contours: Scored[],
  imgW: number,
  imgH: number,
  opts: { travelPenalty?: number; twoOpt?: boolean } = {},
): EtchPlan {
  type Node = { pts: number[]; score: number; kind: 'edge' | 'hatch'; len: number; tier: number };
  const nodes: Node[] = contours.map((c, i) => {
    const pts: number[] = [];
    for (let k = 0; k < c.xs.length; k++) pts.push(c.xs[k] / imgW, c.ys[k] / imgH);
    let len = 0;
    for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], (pts[k + 1] - pts[k - 1]) * (imgH / imgW));
    // drawing priority: main outlines (long edges) → finer detail (short
    // edges, blob rings) → hatching. A sketch interrupted mid-run still
    // reads as a complete line drawing.
    const tier = c.kind === 'hatch' ? 2 : len / Math.max(imgW, imgH) > 0.03 ? 0 : 1;
    return { pts, score: c.strength + len / Math.max(imgW, imgH), kind: c.kind, len, tier };
  });

  const travelPenalty = opts.travelPenalty ?? 0.16;
  const aspect = imgW / imgH;

  // greedy nearest neighbour over endpoints, orientation free
  const open = nodes.slice().sort((a, b) => b.score - a.score);
  const taken = new Set<number>();
  const order: { node: Node; flip: boolean; travel: number }[] = [];

  const idxOf = (n: Node) => nodes.indexOf(n);
  const first = open.sort((a, b) => b.score - a.score)[0];
  if (first) {
    order.push({ node: first, flip: false, travel: 0 });
    taken.add(idxOf(first));
  }

  let cx = order.length ? lastX(order[0].node.pts, order[0].flip) : 0.5;
  let cy = order.length ? lastY(order[0].node.pts, order[0].flip) : 0.5;
  let ldx = 0,
    ldy = 0;

  // tier by tier: the pen completes main outlines before moving to detail
  for (let tier = 0; tier <= 2; tier++) {
    let remaining = nodes.some((n) => n.tier === tier && !taken.has(idxOf(n)));
    while (remaining) {
      let best: { n: Node; flip: boolean; cost: number; dist: number } | null = null;
      for (const cand of open) {
        if (taken.has(idxOf(cand)) || cand.tier !== tier) continue;
        const p = cand.pts;
        for (const flip of [false, true]) {
          const sx = flip ? p[p.length - 2] : p[0];
          const sy = flip ? p[p.length - 1] : p[1];
          const dx = sx - cx;
          const dy = (sy - cy) * aspect;
          const dist = Math.hypot(dx, dy);
          const dl = Math.hypot(dx, dy) || 1;
          const turn = 1 - (dx / dl) * ldx - (dy / dl) * ldy; // prefer continuing direction
          const cost = dist + travelPenalty * Math.max(0, dist - 0.02) + 0.05 * turn;
          if (!best || cost < best.cost) best = { n: cand, flip, cost, dist };
        }
      }
      if (!best) break;
      taken.add(idxOf(best.n));
      order.push({ node: best.n, flip: best.flip, travel: best.dist });
      cx = lastX(best.n.pts, best.flip);
      cy = lastY(best.n.pts, best.flip);
      const p = best.n.pts;
      const fx = flipFirstX(p, best.flip);
      const fy = flipFirstY(p, best.flip);
      const ddx = cx - fx;
      const ddy = (cy - fy) * aspect;
      const dl = Math.hypot(ddx, ddy) || 1;
      ldx = ddx / dl;
      ldy = ddy / dl;
      remaining = nodes.some((n) => n.tier === tier && !taken.has(idxOf(n)));
    }
  }

  // bounded 2-opt flip pass — cheap Chinese-Postman-flavoured cleanup
  if (opts.twoOpt !== false && order.length <= 900) {
    let improved = true;
    let passes = 0;
    while (improved && passes++ < 3) {
      improved = false;
      for (let i = 1; i < order.length - 1; i++) {
        const a = order[i - 1];
        const b = order[i];
        const c = order[i + 1];
        const ax = lastX(a.node.pts, a.flip),
          ay = lastY(a.node.pts, a.flip);
        const bx = firstX(b.node.pts, b.flip),
          by = firstY(b.node.pts, b.flip);
        const bx2 = lastX(b.node.pts, !b.flip),
          by2 = lastY(b.node.pts, !b.flip);
        const cxp = firstX(c.node.pts, c.flip),
          cyp = firstY(c.node.pts, c.flip);
        const cost0 = dist2(ax, ay, bx, by, aspect) + dist2(bx2, by2, cxp, cyp, aspect);
        const cost1 = dist2(ax, ay, bx2, by2, aspect) + dist2(bx, by, cxp, cyp, aspect);
        if (cost1 < cost0 * 0.985) {
          order[i].flip = !order[i].flip;
          improved = true;
        }
      }
    }
  }

  // emit
  const polys: EtchPolyline[] = [];
  let total = 0;
  let prev: { x: number; y: number } | null = order.length
    ? { x: firstX(order[0].node.pts, order[0].flip), y: firstY(order[0].node.pts, order[0].flip) }
    : null;

  for (const o of order) {
    const p = o.node.pts;
    const n = p.length / 2;
    const pts = new Float32Array(p.length);
    for (let i = 0; i < n; i++) {
      const k = o.flip ? n - 1 - i : i;
      pts[i * 2] = p[k * 2];
      pts[i * 2 + 1] = p[k * 2 + 1];
    }
    if (prev) {
      const tx = pts[0],
        ty = pts[1];
      const d = Math.hypot(tx - prev.x, (ty - prev.y) * aspect);
      if (d > 0.002) {
        // travel line carries the pen to the feature; three jittered points
        // so it bows like a dragged pen instead of reading as a ruler line
        const mx = (prev.x + tx) / 2;
        const my = (prev.y + ty) / 2;
        const seed = Math.sin(prev.x * 91.7 + prev.y * 47.3 + tx * 23.1 + ty * 61.9) * 43758.5453;
        const off = (seed - Math.floor(seed) - 0.5) * Math.min(0.03, d * 0.15);
        const ux = (tx - prev.x) / d;
        const uy = (ty - prev.y) / d;
        const trav = new Float32Array(6);
        trav[0] = prev.x;
        trav[1] = prev.y;
        trav[2] = mx - uy * off;
        trav[3] = my + ux * off;
        trav[4] = tx;
        trav[5] = ty;
        polys.push({ pts: trav, travel: true, weight: 0.07 + Math.min(0.035, d * 0.15) });
        total += d;
      }
    }
    for (let i = 0; i + 3 < pts.length; i += 2) {
      total += Math.hypot(pts[i + 2] - pts[i], (pts[i + 3] - pts[i + 1]) * aspect);
    }
    polys.push({
      pts,
      travel: false,
      weight: o.node.kind === 'hatch' ? 0.34 : Math.min(1, 0.55 + o.node.score * 0.8),
    });
    prev = { x: pts[(n - 1) * 2], y: pts[(n - 1) * 2 + 1] };
  }

  return { polys, totalLength: Math.max(total, 1e-3) };
}

const lastX = (p: number[], flip: boolean) => (flip ? p[0] : p[p.length - 2]);
const lastY = (p: number[], flip: boolean) => (flip ? p[1] : p[p.length - 1]);
const firstX = (p: number[], flip: boolean) => (flip ? p[p.length - 2] : p[0]);
const firstY = (p: number[], flip: boolean) => (flip ? p[p.length - 1] : p[1]);
const flipFirstX = firstX;
const flipFirstY = firstY;
const dist2 = (ax: number, ay: number, bx: number, by: number, ar: number) => {
  const dx = bx - ax,
    dy = (by - ay) * ar;
  return Math.sqrt(dx * dx + dy * dy);
};
