/**
 * PlotSession — the machine that etches a mapped plan onto the active face.
 *
 * Constant-speed walk driven by the render loop: each frame advances
 * `drawnLen` by speed·dt, collects the path fragments traversed this frame
 * (one per plan polyline, clipped to the frame's length window), and stamps
 * them through the stroke splitter into per-tile strokes. Frame stamps merge
 * into runs per sticker, so stored geometry stays ~#tile-crossings, not
 * #frames. The cursor (and the K3/K4 knobs) are VIEWS of the plot position.
 * Abort keeps partial strokes (real etch-a-sketch semantics).
 */

import type { CubeViewHandles } from '../three/CubeView';
import { appendStrokeToSticker } from '../three/CubeView';
import { splitPolylineOnFace } from '../core/strokeSplitter';
import type { StrokeItem } from '../core/history';
import { useCubeStore } from '../store/useCubeStore';
import type { MappedPlan } from './planMapper';

const BASE_PLOT_SPEED = 0.25; // face-units per second at 1×

interface Walker {
  plan: MappedPlan;
  /** cumulative length at the start of each polyline */
  polyStarts: number[];
  /** total traversable length (may differ from plan.totalLength) */
  total: number;
  drawnLen: number;
  sessionItems: StrokeItem[];
  finished: boolean;
}

let current: Walker | null = null;

export function startPlot(plan: MappedPlan): boolean {
  const s = useCubeStore.getState();
  if (s.busy !== 'idle') return false;
  const polyStarts: number[] = [];
  let acc = 0;
  for (const p of plan.polys) {
    polyStarts.push(acc);
    acc += polyLen(p.pts);
  }
  current = {
    plan,
    polyStarts,
    total: acc,
    drawnLen: 0,
    sessionItems: [],
    finished: acc === 0,
  };
  useCubeStore.setState({
    busy: 'plotting',
    plotting: { status: 'plotting', stage: 'etching', progress: 0 },
    cursor: { ...s.cursor, visible: true },
  });
  if (current.finished) finishPlot();
  return true;
}

export function plotActive(): boolean {
  return current !== null && !current.finished;
}

export function plotProgress(): number {
  if (!current) return 0;
  return current.total === 0 ? 1 : current.drawnLen / current.total;
}

/** resume a serialized mid-flight plot (already-stamped strokes live in state) */
export function resumePlot(plan: MappedPlan, drawnLen: number, existingItems: StrokeItem[]): boolean {
  const ok = startPlot(plan);
  if (!ok || !current) return false;
  current.drawnLen = Math.min(drawnLen, current.total);
  current.sessionItems = existingItems;
  return true;
}

export function currentPlot(): { plan: MappedPlan; drawnLen: number; items: StrokeItem[] } | null {
  return current ? { plan: current.plan, drawnLen: current.drawnLen, items: current.sessionItems } : null;
}

/** called every frame from the canvas update hook */
export function tickPlot(dt: number, handles: CubeViewHandles): void {
  const w = current;
  if (!w || w.finished) return;
  const speed = BASE_PLOT_SPEED * useCubeStore.getState().speed;
  const from = w.drawnLen;
  const to = Math.min(w.total, from + speed * dt);
  w.drawnLen = to;

  stampRange(w, from, to, handles);

  const pos = positionAt(w, to);
  if (pos) {
    useCubeStore.setState({
      cursor: { u: pos.u, v: pos.v, visible: true },
      plotting: { status: 'plotting', stage: 'etching', progress: plotProgress() },
    });
  }

  if (to >= w.total) finishPlot();
}

interface Fragment {
  pts: number[];
  weight: number;
  travel: boolean;
  closed?: boolean;
}

/** stamp the geometry traversed in the length window [fromLen, toLen] */
function stampRange(w: Walker, fromLen: number, toLen: number, handles: CubeViewHandles): void {
  if (toLen <= fromLen) return;
  const face = useCubeStore.getState().activeFace;
  const cube = useCubeStore.getState().session.cube;
  const store = useCubeStore.getState();
  for (const frag of collectFragments(w, fromLen, toLen)) {
    if (frag.pts.length < 4) continue;
    const subs = splitPolylineOnFace(cube, face, frag.pts, {
      weight: frag.weight,
      travel: frag.travel,
      ...(frag.closed ? { closed: true } : {}),
    });
    for (const sub of subs) {
      const item: StrokeItem = {
        stickerId: sub.stickerId,
        stroke: {
          id: sub.strokeId,
          pts: sub.pts,
          weight: sub.weight,
          travel: sub.travel,
          ...(sub.closed ? { closed: true } : {}),
        },
      };
      // merge with the previous run when still on the same tile
      const last = w.sessionItems[w.sessionItems.length - 1];
      if (last && last.stickerId === item.stickerId) {
        last.stroke.pts.push(...item.stroke.pts.slice(2));
      } else {
        w.sessionItems.push(item);
      }
      store.appendPlotStrokes([item]);
      appendStrokeToSticker(handles, item.stickerId, item.stroke);
    }
  }
}

/**
 * Per-polyline path fragments covered by [fromLen, toLen], each clipped to
 * the window with interpolated endpoints. Consecutive segments share vertex
 * points (deduped), so fragments are true sub-polylines.
 */
function collectFragments(w: Walker, fromLen: number, toLen: number): Fragment[] {
  const out: Fragment[] = [];
  for (let pi = 0; pi < w.plan.polys.length; pi++) {
    const poly = w.plan.polys[pi];
    const start = w.polyStarts[pi];
    const plen = polyLen(poly.pts);
    if (plen === 0 || start + plen < fromLen || start > toLen) continue;
    const pts: number[] = [];
    let acc = start;
    for (let k = 0; k + 3 < poly.pts.length; k += 2) {
      const segLen = Math.hypot(poly.pts[k + 2] - poly.pts[k], poly.pts[k + 3] - poly.pts[k + 1]);
      if (segLen === 0) continue;
      const segStart = acc;
      const segEnd = acc + segLen;
      acc = segEnd;
      if (segEnd <= fromLen || segStart >= toLen) continue;
      const t0 = Math.max(0, (fromLen - segStart) / segLen);
      const t1 = Math.min(1, (toLen - segStart) / segLen);
      const ax = poly.pts[k];
      const ay = poly.pts[k + 1];
      const bx = poly.pts[k + 2];
      const by = poly.pts[k + 3];
      const px0 = ax + (bx - ax) * t0;
      const py0 = ay + (by - ay) * t0;
      const px1 = ax + (bx - ax) * t1;
      const py1 = ay + (by - ay) * t1;
      const n = pts.length;
      if (n >= 2 && Math.abs(pts[n - 2] - px0) < 1e-9 && Math.abs(pts[n - 1] - py0) < 1e-9) {
        pts.push(px1, py1); // contiguous with previous segment
      } else {
        pts.push(px0, py0, px1, py1);
      }
    }
    if (pts.length >= 4) {
      out.push({
        pts,
        weight: poly.weight,
        travel: poly.travel,
        ...(poly.closed ? { closed: true } : {}),
      });
    }
  }
  return out;
}

/** pen position at an absolute length (null when past the end) */
function positionAt(w: Walker, len: number): { u: number; v: number } | null {
  for (let pi = 0; pi < w.plan.polys.length; pi++) {
    const poly = w.plan.polys[pi];
    const start = w.polyStarts[pi];
    const plen = polyLen(poly.pts);
    if (plen === 0) continue;
    if (len > start + plen) continue;
    let acc = start;
    for (let k = 0; k + 3 < poly.pts.length; k += 2) {
      const segLen = Math.hypot(poly.pts[k + 2] - poly.pts[k], poly.pts[k + 3] - poly.pts[k + 1]);
      if (segLen === 0) continue;
      if (len <= acc + segLen) {
        const t = (len - acc) / segLen;
        return {
          u: poly.pts[k] + (poly.pts[k + 2] - poly.pts[k]) * t,
          v: poly.pts[k + 1] + (poly.pts[k + 3] - poly.pts[k + 1]) * t,
        };
      }
      acc += segLen;
    }
    const last = poly.pts.length - 2;
    return { u: poly.pts[last], v: poly.pts[last + 1] };
  }
  return null;
}

function finishPlot(): void {
  const w = current;
  if (!w) return;
  const store = useCubeStore.getState();
  store.commitPlotBatch(w.sessionItems);
  store.setReferenceNow();
  useCubeStore.setState({
    busy: 'idle',
    plotting: { status: 'idle', stage: '', progress: 1 },
    banner: { text: 'Etched — scramble it, then solve to restore', at: Date.now() },
  });
  current = null;
}

/** stop the plot; partial strokes are kept and committed as one command */
export function abortPlot(): void {
  const w = current;
  if (!w) return;
  const store = useCubeStore.getState();
  if (w.sessionItems.length > 0) {
    store.commitPlotBatch(w.sessionItems);
  }
  useCubeStore.setState({
    busy: 'idle',
    plotting: { status: 'idle', stage: '', progress: 0 },
    banner: { text: 'Plot stopped — partial etch kept', at: Date.now() },
  });
  current = null;
}

function polyLen(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  }
  return len;
}
