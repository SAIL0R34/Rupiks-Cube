/**
 * Stroke splitter: decompose a face-space polyline into per-tile sub-strokes.
 *
 * A planned etch polyline wanders across the whole face; the cube stores art
 * per tile. This walks each segment parametrically, finds where it crosses
 * tile-seam gridlines (u,v = 1 or 2) and the face border ([0,3]), splits into
 * per-cell pieces, merges consecutive same-cell pieces into maximal runs, and
 * converts each run into a tile-local stroke on the sticker of that cell.
 *
 * The face→tile mapping is a per-cell isometry (integer rotation + shift), so
 * total length is conserved exactly (up to float error) — the conservation
 * property test relies on this.
 */

import type { Face } from './faces';
import type { CubeState } from './cubeState';
import { faceCellToTile } from './transform';
import { allocStrokeId } from './stickers';

export interface SubStroke {
  stickerId: number;
  /** tile-local interleaved x,y in [0,1] */
  pts: number[];
  weight: number;
  travel: boolean;
  closed?: boolean;
  strokeId: number;
}

export interface StrokeProps {
  weight: number;
  travel: boolean;
  closed?: boolean;
}

const EPS = 1e-9;

export function splitPolylineOnFace(
  state: CubeState,
  face: Face,
  pts: number[],
  props: StrokeProps,
): SubStroke[] {
  const out: SubStroke[] = [];
  // current run being accumulated across segment pieces
  let runCell: [number, number] | null = null;
  let runPts: number[] = [];

  const flush = () => {
    if (runCell && runPts.length >= 4) {
      out.push(buildSubStroke(state, face, runCell, runPts, props));
    }
    runCell = null;
    runPts = [];
  };

  for (let k = 2; k < pts.length; k += 2) {
    const u0 = pts[k - 2];
    const v0 = pts[k - 1];
    const u1 = pts[k];
    const v1 = pts[k + 1];
    const du = u1 - u0;
    const dv = v1 - v0;
    if (Math.abs(du) < 1e-12 && Math.abs(dv) < 1e-12) continue;

    // λs where the segment crosses the face border (clip) and inner gridlines
    const lambdas = collectLambdas(u0, v0, du, dv);

    for (let m = 0; m + 1 < lambdas.length; m++) {
      const la = lambdas[m];
      const lb = lambdas[m + 1];
      if (lb - la < 1e-12) continue;
      const midU = u0 + du * ((la + lb) / 2);
      const midV = v0 + dv * ((la + lb) / 2);
      if (midU < -EPS || midU > 3 + EPS || midV < -EPS || midV > 3 + EPS) continue;
      const cell = cellOf(midU, midV, du, dv);
      if (runCell && (runCell[0] !== cell[0] || runCell[1] !== cell[1])) {
        // close the previous piece's end into the old run first
        runPts.push(u0 + du * la, v0 + dv * la);
        flush();
      }
      if (!runCell) {
        runCell = cell;
        runPts = [u0 + du * la, v0 + dv * la];
      }
      runPts.push(u0 + du * lb, v0 + dv * lb);
    }
  }
  flush();
  return out;
}

/**
 * Sorted λ breakpoints of a segment within the face box [0,3]², including
 * 0 and 1. Includes box-border crossings (clipping) and inner gridlines
 * u,v ∈ {1,2}.
 */
function collectLambdas(u0: number, v0: number, du: number, dv: number): number[] {
  const ls: number[] = [0, 1];
  // box borders: u,v ∈ {0,3} and inner gridlines u,v ∈ {1,2}
  if (Math.abs(du) > 1e-12) {
    for (const k of [0, 1, 2, 3]) pushLambda(ls, u0, du, k);
  }
  if (Math.abs(dv) > 1e-12) {
    for (const k of [0, 1, 2, 3]) pushLambda(ls, v0, dv, k);
  }
  ls.sort((a, b) => a - b);
  // dedupe
  const out: number[] = [];
  for (const l of ls) {
    if (out.length === 0 || l - out[out.length - 1] > 1e-12) out.push(l);
  }
  return out.length >= 2 ? out : [0, 1];
}

function pushLambda(ls: number[], p0: number, d: number, k: number): void {
  const l = (k - p0) / d;
  if (l > EPS && l < 1 - EPS) ls.push(l);
}

/**
 * Half-open cell resolution with a direction nudge: a point exactly on a
 * gridline belongs to the cell it is entering (or leaving toward), so hatch
 * endpoints landing exactly on seams resolve deterministically. Overshoots
 * past the border clamp into the edge cells.
 */
function cellOf(u: number, v: number, du: number, dv: number): [number, number] {
  const i = clampIdx(Math.floor(u + (du > 0 ? EPS : du < 0 ? -EPS : 0)));
  const j = clampIdx(Math.floor(v + (dv > 0 ? EPS : dv < 0 ? -EPS : 0)));
  return [i, j];
}

function clampIdx(x: number): number {
  return x < 0 ? 0 : x > 2 ? 2 : x;
}

function buildSubStroke(
  state: CubeState,
  face: Face,
  cell: [number, number],
  facePts: number[],
  props: StrokeProps,
): SubStroke {
  const { sticker, s, t } = faceCellToTile(state, face, cell[0], cell[1], facePts[0], facePts[1]);
  const pts: number[] = [s, t];
  for (let k = 2; k < facePts.length; k += 2) {
    const q = faceCellToTile(state, face, cell[0], cell[1], facePts[k], facePts[k + 1]);
    const lastS = pts[pts.length - 2];
    const lastT = pts[pts.length - 1];
    if (Math.abs(q.s - lastS) < 1e-9 && Math.abs(q.t - lastT) < 1e-9) continue; // dedupe
    pts.push(q.s, q.t);
  }
  return {
    stickerId: sticker.id,
    pts,
    weight: props.weight,
    travel: props.travel,
    ...(props.closed ? { closed: true } : {}),
    strokeId: allocStrokeId(),
  };
}

/** total length of a sub-stroke in tile units (conservation checks) */
export function subStrokeLength(s: SubStroke): number {
  let len = 0;
  for (let i = 2; i < s.pts.length; i += 2) {
    len += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
  }
  return len;
}
