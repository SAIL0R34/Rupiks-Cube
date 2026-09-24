/**
 * Face-space ↔ tile-local coordinate transforms.
 *
 * Face space: (u,v) ∈ [0,3]² over a face's 3×3 grid. Tile space: (s,t) ∈ [0,1]²
 * on a sticker, welded to the sticker's cubie-local frame. The asymmetry is
 * deliberate and is what makes artwork fragment correctly: the sticker's 2D
 * frame is fixed in cubie-local space, so after a layer turn the cubie's
 * orientation R automatically accounts for the relative rotation between the
 * art and the face it now sits on.
 */

import type { Vec3 } from './rotation';
import { applyVec, transpose } from './rotation';
import type { Face } from './faces';
import { FACE_FRAME, cellCubiePos, dot } from './faces';
import type { CubeState, Cubie } from './cubeState';
import { posKey } from './cubeState';
import type { Sticker } from './stickers';
import { faceOfNormal } from './faces';

export interface TilePoint {
  sticker: Sticker;
  /** tile-local coords [0,1]² */
  s: number;
  t: number;
}

/**
 * Map a face-space point to the sticker under it and that sticker's local
 * coords. Points exactly on seams resolve to the cell floor(u),floor(v) with
 * clamping at the borders.
 */
export function faceToTile(state: CubeState, face: Face, u: number, v: number): TilePoint {
  const i = clampIdx(Math.floor(u));
  const j = clampIdx(Math.floor(v));
  return faceCellToTile(state, face, i, j, u, v);
}

/**
 * Map a face-space point using an EXPLICIT cell (i,j). Points on the cell's
 * right/top border (cu or cv == 1) map to s/t == 1 of THIS cell, which is what
 * the stroke splitter needs: a run's boundary point must land on the edge of
 * the run's own tile, not flip into the neighbor.
 */
export function faceCellToTile(
  state: CubeState,
  face: Face,
  i: number,
  j: number,
  u: number,
  v: number,
): TilePoint {
  const frame = FACE_FRAME[face];
  const pos = cellCubiePos(face, i, j);
  const cubie = state.posIndex.get(posKey(pos));
  if (!cubie) throw new Error(`no cubie at ${posKey(pos)} for face ${face} cell ${i},${j}`);
  const sticker = stickerOnFace(cubie, frame.n);
  return { sticker, ...facePointToTile(cubie, sticker, frame, u - i, v - j) };
}

export interface FacePoint {
  u: number;
  v: number;
}

/**
 * Inverse map: a point on a sticker (tile-local) → the face it currently
 * shows and that face's coords.
 */
export function tileToFace(cubie: Cubie, sticker: Sticker, s: number, t: number): FacePoint & { face: Face } {
  const face = faceOfNormal(applyVec(cubie.R, sticker.localNormal));
  const frame = FACE_FRAME[face];
  const i = dot(cubie.pos, frame.uAxis) + 1;
  const j = dot(cubie.pos, frame.vAxis) + 1;
  const localFrame = FACE_FRAME[faceOfNormal(sticker.localNormal)];
  const dLocal: Vec3 = [
    (s - 0.5) * localFrame.uAxis[0] + (t - 0.5) * localFrame.vAxis[0],
    (s - 0.5) * localFrame.uAxis[1] + (t - 0.5) * localFrame.vAxis[1],
    (s - 0.5) * localFrame.uAxis[2] + (t - 0.5) * localFrame.vAxis[2],
  ];
  const dWorld = applyVec(cubie.R, dLocal);
  return {
    face,
    u: i + 0.5 + dot(dWorld, frame.uAxis),
    v: j + 0.5 + dot(dWorld, frame.vAxis),
  };
}

/** the sticker of this cubie currently facing world normal n (exact match) */
export function stickerOnFace(cubie: Cubie, n: Vec3): Sticker {
  for (const s of cubie.stickers) {
    const w = applyVec(cubie.R, s.localNormal);
    if (w[0] === n[0] && w[1] === n[1] && w[2] === n[2]) return s;
  }
  throw new Error(`cubie ${cubie.id} has no sticker facing ${n.join(',')}`);
}

/**
 * Core 2D projection shared by faceToTile: given the cubie/sticker and the
 * point's offset within cell (cu, cv) ∈ [0,1)² relative to the cell origin,
 * produce tile-local (s,t).
 */
function facePointToTile(
  cubie: Cubie,
  sticker: Sticker,
  frame: (typeof FACE_FRAME)[Face],
  cu: number,
  cv: number,
): { s: number; t: number } {
  const dWorld: Vec3 = [
    (cu - 0.5) * frame.uAxis[0] + (cv - 0.5) * frame.vAxis[0],
    (cu - 0.5) * frame.uAxis[1] + (cv - 0.5) * frame.vAxis[1],
    (cu - 0.5) * frame.uAxis[2] + (cv - 0.5) * frame.vAxis[2],
  ];
  const dLocal = applyVec(transpose(cubie.R), dWorld);
  const localFrame = FACE_FRAME[faceOfNormal(sticker.localNormal)];
  return {
    s: 0.5 + dot(dLocal, localFrame.uAxis),
    t: 0.5 + dot(dLocal, localFrame.vAxis),
  };
}

function clampIdx(x: number): number {
  return x < 0 ? 0 : x > 2 ? 2 : x;
}
