/**
 * The 18 outer-layer moves (U/D/L/R/F/B × CW / CCW / double).
 *
 * Sign convention (see rotation.ts): a CLOCKWISE turn of a face viewed from
 * outside that face is a rotation of −90° about the face's outward normal.
 * Verified by hand: F CW takes UFR(1,1,1) → DFR(1,−1,1); R CW takes
 * UFR(1,1,1) → UBR(1,1,−1).
 *
 * applyMove premultiplies: `R ← T·R` (the turn acts in the world frame), and
 * rotates positions exactly. Strokes ride along implicitly in cubie-local
 * space.
 */

import type { Mat3, Vec3 } from './rotation';
import { applyVec, mulMat, turnMat } from './rotation';
import type { Face } from './faces';
import { FACE_FRAME } from './faces';
import { dot } from './faces';
import type { CubeState, Cubie } from './cubeState';
import { posKey } from './cubeState';

export type MoveToken =
  | 'U' | "U'" | 'U2'
  | 'D' | "D'" | 'D2'
  | 'L' | "L'" | 'L2'
  | 'R' | "R'" | 'R2'
  | 'F' | "F'" | 'F2'
  | 'B' | "B'" | 'B2';

export const MOVE_TOKENS: readonly MoveToken[] = [
  'U', "U'", 'U2', 'D', "D'", 'D2', 'L', "L'", 'L2',
  'R', "R'", 'R2', 'F', "F'", 'F2', 'B', "B'", 'B2',
];

export interface MoveDef {
  readonly token: MoveToken;
  readonly face: Face;
  /** exact turn matrix applied to positions and (premultiplied to) orientations */
  readonly T: Mat3;
}

function axisOf(n: Vec3): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } {
  if (n[0] !== 0) return { axis: 'x', sign: n[0] > 0 ? 1 : -1 };
  if (n[1] !== 0) return { axis: 'y', sign: n[1] > 0 ? 1 : -1 };
  return { axis: 'z', sign: n[2] > 0 ? 1 : -1 };
}

function buildMove(face: Face, quarterTurns: 1 | 2 | 3, suffix: '' | "'" | '2'): MoveDef {
  const n = FACE_FRAME[face].n;
  const { axis, sign } = axisOf(n);
  return {
    token: `${face}${suffix}` as MoveToken,
    face,
    T: turnMat(axis, sign, quarterTurns),
  };
}

export const MOVE_TABLE: Readonly<Record<MoveToken, MoveDef>> = Object.freeze(
  Object.fromEntries(
    (['U', 'D', 'L', 'R', 'F', 'B'] as Face[]).flatMap((face) => [
      buildMove(face, 1, ''),
      buildMove(face, 3, "'"),
      buildMove(face, 2, '2'),
    ]).map((def) => [def.token, def]),
  ) as Record<MoveToken, MoveDef>,
);

export function parseMove(token: string): MoveDef {
  const def = MOVE_TABLE[token as MoveToken];
  if (!def) throw new Error(`bad move token: ${token}`);
  return def;
}

export function inverseMove(token: MoveToken): MoveToken {
  if (token.endsWith("2")) return token;
  return token.endsWith("'") ? (token.slice(0, 1) as MoveToken) : (`${token}'` as MoveToken);
}

/** inverse of a sequence: reverse order, invert each */
export function inverseSeq(tokens: readonly MoveToken[]): MoveToken[] {
  return [...tokens].reverse().map(inverseMove);
}

/**
 * Apply a move, returning a NEW CubeState (affected cubies cloned; unaffected
 * cubies structurally shared). Positions rotate exactly; orientations
 * premultiply: `R' = T·R`.
 */
export function applyMove(state: CubeState, token: MoveToken): CubeState {
  const def = parseMove(token);
  const n = FACE_FRAME[def.face].n;
  const affected = new Set<number>();
  const cubies = state.cubies.map((c) => {
    if (dot(c.pos, n) !== 1) return c; // shared reference
    affected.add(c.id);
    return {
      ...c,
      pos: applyVec(def.T, c.pos),
      R: mulMat(def.T, c.R),
      stickers: c.stickers, // stickers ride along by reference
    } as Cubie;
  });
  if (affected.size !== 9) {
    throw new Error(`move ${token} affected ${affected.size} cubies, expected 9`);
  }
  const posIndex = new Map<string, Cubie>();
  for (const c of cubies) posIndex.set(posKey(c.pos), c);
  return { cubies, posIndex };
}

export function applyMoves(state: CubeState, tokens: readonly MoveToken[]): CubeState {
  let s = state;
  for (const t of tokens) s = applyMove(s, t);
  return s;
}

export function formatMoves(tokens: readonly MoveToken[]): string {
  return tokens.join(' ');
}
