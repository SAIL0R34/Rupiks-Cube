/**
 * Strokes and stickers.
 *
 * A Stroke is an immutable polyline in TILE-LOCAL 2D space ([0,1]², interleaved
 * x/y), welded to its sticker's cubie geometry. Because strokes live in
 * cubie-local space, layer turns move and rotate them implicitly — that is the
 * artwork-fragmentation mechanic. Strokes are never mutated after creation;
 * they carry globally unique ids so history commands can address them wherever
 * they currently live.
 */

import type { Vec3 } from './rotation';
import { applyVec } from './rotation';
import type { Face } from './faces';
import { FACE_FRAME } from './faces';
import { faceOfNormal } from './faces';

export interface Stroke {
  readonly id: number;
  /** interleaved x,y,x,y,... in [0,1] tile-local coords */
  pts: number[];
  /** drawing pressure / darkness 0..1 */
  weight: number;
  /** true = non-drawing travel move (rendered faint) */
  travel: boolean;
  closed?: boolean;
}

export interface Sticker {
  readonly id: number;
  readonly cubieId: number;
  /** outward normal in CUBIE-LOCAL frame — constant for all time */
  readonly localNormal: Vec3;
  strokes: Stroke[];
}

// --- stroke id allocation (monotonic; high-water mark persists in saves) ---

let strokeIdHi = 0;

export function allocStrokeId(): number {
  return ++strokeIdHi;
}

/** restore the high-water mark after loading a save (tests + deserialization) */
export function setStrokeIdHi(value: number): void {
  strokeIdHi = Math.max(strokeIdHi, value);
}

export function peekStrokeIdHi(): number {
  return strokeIdHi;
}

// --- geometry helpers -------------------------------------------------------

/** world-frame outward normal of a sticker on a cubie with orientation R */
export function worldNormal(cubieR: import('./rotation').Mat3, sticker: Sticker): Vec3 {
  return applyVec(cubieR, sticker.localNormal);
}

/**
 * The face (world direction) this sticker is currently showing.
 * Throws if the normal is not a face normal (should be impossible for valid R).
 */
export function stickerFace(cubieR: import('./rotation').Mat3, sticker: Sticker): Face {
  return faceOfNormal(worldNormal(cubieR, sticker));
}

/** face frame lookup keyed by a (local) normal — shared with the renderer */
export function frameForNormal(n: Vec3) {
  return FACE_FRAME[faceOfNormal(n)];
}
