/**
 * CubeState: 26 cubies (the 3×3×3 minus the hidden core) + position index.
 *
 * Cubie: integer position ∈ {−1,0,1}³ and interned orientation matrix R with
 * `p_world = R·p_local + pos`. Stickers are owned by their cubie forever;
 * tile CONTENT (image dataURLs) lives in the Session, addressed by sticker id.
 */

import type { Mat3, Vec3 } from './rotation';
import { IDENTITY, orientationIndex } from './rotation';
import type { Sticker } from './stickers';
import { dot } from './faces';

export interface Cubie {
  readonly id: number;
  pos: Vec3;
  R: Mat3;
  stickers: Sticker[];
}

export interface CubeState {
  cubies: Cubie[];
  /** "x,y,z" → cubie, rebuilt on every move */
  posIndex: Map<string, Cubie>;
}

export function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

export function cubieAt(state: CubeState, p: Vec3): Cubie | undefined {
  return state.posIndex.get(posKey(p));
}

function rebuildIndex(state: CubeState): void {
  state.posIndex = new Map(state.cubies.map((c) => [posKey(c.pos), c]));
}

/** Fresh solved cube: 26 cubies, 54 stickers, all orientations identity. */
export function createSolvedCube(): CubeState {
  const cubies: Cubie[] = [];
  let cubieId = 0;
  let stickerId = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const stickers: Sticker[] = [];
        const axes: Array<[number, Vec3]> = [
          [x, [1, 0, 0]],
          [y, [0, 1, 0]],
          [z, [0, 0, 1]],
        ];
        for (const [coord, unit] of axes) {
          if (coord === 0) continue;
          stickers.push({
            id: stickerId++,
            cubieId,
            localNormal: [coord * unit[0], coord * unit[1], coord * unit[2]],
          });
        }
        cubies.push({ id: cubieId++, pos: [x, y, z], R: IDENTITY, stickers });
      }
    }
  }
  const state: CubeState = { cubies, posIndex: new Map() };
  rebuildIndex(state);
  return state;
}

/** deep structural clone (snapshots, serialization prep) */
export function cloneCubeState(state: CubeState): CubeState {
  const cubies = state.cubies.map((c) => ({ ...c, stickers: c.stickers.map((s) => ({ ...s })) }));
  const out: CubeState = { cubies, posIndex: new Map() };
  rebuildIndex(out);
  return out;
}

/** exact deep equality (integer state — no epsilon) */
export function cubeStatesEqual(a: CubeState, b: CubeState): boolean {
  if (a.cubies.length !== b.cubies.length) return false;
  for (const ca of a.cubies) {
    const cb = b.posIndex.get(posKey(ca.pos));
    if (!cb || cb.id !== ca.id) return false;
    if (orientationIndex(ca.R) !== orientationIndex(cb.R)) return false;
    if (ca.stickers.length !== cb.stickers.length) return false;
    for (let i = 0; i < ca.stickers.length; i++) {
      if (ca.stickers[i].id !== cb.stickers[i].id) return false;
    }
  }
  return true;
}

/** structural invariants: 26 cubies, 54 stickers, valid positions */
export function checkInvariants(state: CubeState): void {
  if (state.cubies.length !== 26) throw new Error(`expected 26 cubies, got ${state.cubies.length}`);
  const stickerIds = new Set<number>();
  let stickerCount = 0;
  for (const c of state.cubies) {
    for (const v of c.pos) {
      if (!Number.isInteger(v) || Math.abs(v) > 1) {
        throw new Error(`cubie ${c.id} has non-lattice position ${c.pos.join(',')}`);
      }
    }
    for (const s of c.stickers) {
      if (s.cubieId !== c.id) throw new Error(`sticker ${s.id} claims cubie ${s.cubieId}, lives on ${c.id}`);
      stickerIds.add(s.id);
      stickerCount++;
    }
  }
  if (stickerCount !== 54) throw new Error(`expected 54 stickers, got ${stickerCount}`);
  if (stickerIds.size !== 54) throw new Error(`duplicate sticker ids: ${stickerIds.size} unique`);
  if (state.posIndex.size !== 26) throw new Error(`posIndex has ${state.posIndex.size} entries`);
}

/** the 9 cubies of an outer layer (dot(pos, n) === 1) */
export function layerCubies(state: CubeState, n: Vec3): Cubie[] {
  return state.cubies.filter((c) => dot(c.pos, n) === 1);
}
