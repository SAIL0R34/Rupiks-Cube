/**
 * faceBlit — put a (square) face image onto the 9 tiles currently facing a
 * face, respecting each cubie's CURRENT orientation.
 *
 * Math: for each face cell (i,j), map the cell's corners from face coords to
 * tile-local coords via `faceCellToTile` (core/transform.ts). The four mapped
 * corners form an integer rotation (det is always +1 for legal orientations —
 * no flips), giving an exact affine for drawing the image's cell region into
 * the tile canvas. On a solved cube this is the identity per cell; on a
 * scrambled cube the region lands rotated — which is correct: the tile is
 * welded to its cubie.
 */

import type { CubeState } from '../core/cubeState';
import type { Face } from '../core/faces';
import { faceCellToTile } from '../core/transform';

export interface TilePaint {
  stickerId: number;
  /** tile canvas dataURL */
  dataUrl: string;
}

/**
 * Compute, for every cell of `face`, which sticker owns it and the affine
 * (as a corner quad in tile-local [0,1]²) that maps the image's cell region
 * into that sticker's tile space.
 */
export function faceCellAffines(
  state: CubeState,
  face: Face,
): Array<{
  i: number;
  j: number;
  stickerId: number;
  /** tile-space corners of the cell: (0,0) (1,0) (1,1) (0,1) image corners */
  quad: Array<{ s: number; t: number }>;
}> {
  const out: ReturnType<typeof faceCellAffines> = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const c00 = faceCellToTile(state, face, i, j, i, j);
      const c10 = faceCellToTile(state, face, i, j, i + 1, j);
      const c11 = faceCellToTile(state, face, i, j, i + 1, j + 1);
      const c01 = faceCellToTile(state, face, i, j, i, j + 1);
      out.push({
        i,
        j,
        stickerId: c00.sticker.id,
        quad: [
          { s: c00.s, t: c00.t },
          { s: c10.s, t: c10.t },
          { s: c11.s, t: c11.t },
          { s: c01.s, t: c01.t },
        ],
      });
    }
  }
  return out;
}

/**
 * Blit a square source region onto one tile canvas. `quad` gives where the
 * face-cell's corners (i,j) (i+1,j) (i+1,j+1) (i,j+1) land in tile-local
 * (s,t). Image x+ = face u+, image y+ (down) = face v− (down) — so the
 * source rect's top-left is the face cell's TOP-left corner, quad[3], and
 * the source edges run to quad[2] (x+) and quad[0] (y+). For integer
 * rotations the quad is a rotated unit square; the affine follows exactly.
 */
export function blitCellToTileCanvas(
  tileCtx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcX: number,
  srcY: number,
  srcSize: number,
  quad: Array<{ s: number; t: number }>,
  tileSize: number,
): void {
  // tile-space px of a point: (s·W, (1−t)·W)
  const W = tileSize;
  const px = (p: { s: number; t: number }) => [p.s * W, (1 - p.t) * W] as const;
  const [x3, y3] = px(quad[3]); // source (0,0) — face-cell top-left
  const ex = [px(quad[2])[0] - x3, px(quad[2])[1] - y3]; // source x+ edge
  const ey = [px(quad[0])[0] - x3, px(quad[0])[1] - y3]; // source y+ edge
  const a = ex[0] / W;
  const b = ex[1] / W;
  const c = ey[0] / W;
  const d = ey[1] / W;
  tileCtx.save();
  tileCtx.clearRect(0, 0, W, W);
  // clip to the tile so seams stay clean even under float fuzz
  const clip = new Path2D();
  clip.moveTo(...px(quad[0]));
  clip.lineTo(...px(quad[1]));
  clip.lineTo(...px(quad[2]));
  clip.lineTo(...px(quad[3]));
  clip.closePath();
  tileCtx.clip(clip);
  tileCtx.setTransform(a, b, c, d, x3, y3);
  tileCtx.imageSmoothingQuality = 'high';
  tileCtx.drawImage(source, srcX, srcY, srcSize, srcSize, 0, 0, W, W);
  tileCtx.restore();
}

/**
 * Produce the 9 tile paints for a face: square source image → per-cell
 * rotated crops as dataURLs (state-level; the scene applies them).
 *
 * Band mapping: face j=0 is the BOTTOM row of the face but image band 0 is
 * the TOP of the picture (image y grows down) — so cell j samples image band
 * (2−j). The in-band orientation is handled by the affine in
 * blitCellToTileCanvas.
 */
export function paintFaceTiles(
  state: CubeState,
  face: Face,
  squareSource: HTMLCanvasElement,
  tileSize = 256,
): TilePaint[] {
  const cellPx = squareSource.width / 3;
  const paints: TilePaint[] = [];
  for (const { i, j, stickerId, quad } of faceCellAffines(state, face)) {
    const canvas = document.createElement('canvas');
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext('2d')!;
    blitCellToTileCanvas(ctx, squareSource, i * cellPx, (2 - j) * cellPx, cellPx, quad, tileSize);
    paints.push({ stickerId, dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
  }
  return paints;
}

/** a sticker's current world normal (for picking/highlight) */
export function stickerWorldNormal(
  state: CubeState,
  stickerId: number,
): readonly number[] {
  for (const c of state.cubies) {
    for (const s of c.stickers) {
      if (s.id !== stickerId) continue;
      const R = c.R;
      const ln = s.localNormal;
      return [
        R[0] * ln[0] + R[1] * ln[1] + R[2] * ln[2],
        R[3] * ln[0] + R[4] * ln[1] + R[5] * ln[2],
        R[6] * ln[0] + R[7] * ln[1] + R[8] * ln[2],
      ];
    }
  }
  throw new Error(`sticker ${stickerId} not found`);
}
