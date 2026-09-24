/**
 * Stickers — the 54 drawable tiles.
 *
 * A sticker's pixels are stored OUTSIDE the cube state (Session.tiles, as
 * dataURLs keyed by sticker id) and rendered onto its own canvas texture. The
 * sticker itself only carries identity geometry: its cubie-local outward
 * normal, constant for all time. Because tile content is addressed by sticker
 * id and stickers are owned by their cubie forever, images ride the cubies
 * through every layer turn — the fragmentation mechanic.
 */

import type { Vec3 } from './rotation';
import type { Mat3 } from './rotation';
import { applyVec } from './rotation';

export interface Sticker {
  readonly id: number;
  readonly cubieId: number;
  /** outward normal in CUBIE-LOCAL frame — constant for all time */
  readonly localNormal: Vec3;
}

/** world-frame outward normal of a sticker on a cubie with orientation R */
export function worldNormal(cubieR: Mat3, sticker: Sticker): Vec3 {
  return applyVec(cubieR, sticker.localNormal);
}
