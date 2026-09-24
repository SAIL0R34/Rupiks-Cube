/**
 * The 24 layer moves: U/D/L/R/F/B (outer layers) + M/E/S (middle slices),
 * each × CW / CCW / double.
 *
 * Generalized representation: every move selects the cubie layer at
 * `pos[axis] === coord` and rotates it by `cwSign·90°` per CW quarter turn
 * about `+axis` (right-handed). Slices let the middle row/column be dragged
 * directly, which the click-twist interaction makes natural.
 *
 * Slice conventions (standard): M follows L, E follows D, S follows F.
 *
 * Sign convention (see rotation.ts): a CLOCKWISE turn viewed from outside the
 * reference face is −90° about that face's outward normal. Verified: F CW
 * takes UFR(1,1,1) → DFR(1,−1,1); R CW takes UFR → UBR(1,1,−1).
 */

import type { Mat3, Vec3 } from './rotation';
import { internMat, turnMat } from './rotation';
import type { CubeState, Cubie } from './cubeState';
import { posKey } from './cubeState';

export type Axis = 'x' | 'y' | 'z';

export type MoveToken =
  | 'U' | "U'" | 'U2'
  | 'D' | "D'" | 'D2'
  | 'L' | "L'" | 'L2'
  | 'R' | "R'" | 'R2'
  | 'F' | "F'" | 'F2'
  | 'B' | "B'" | 'B2'
  | 'M' | "M'" | 'M2'
  | 'E' | "E'" | 'E2'
  | 'S' | "S'" | 'S2';

export const MOVE_TOKENS: readonly MoveToken[] = [
  'U', "U'", 'U2', 'D', "D'", 'D2', 'L', "L'", 'L2',
  'R', "R'", 'R2', 'F', "F'", 'F2', 'B', "B'", 'B2',
  'M', "M'", 'M2', 'E', "E'", 'E2', 'S', "S'", 'S2',
];

export interface MoveDef {
  readonly token: MoveToken;
  /** layer selection: cubies with pos[axis] === coord */
  readonly axis: Axis;
  readonly coord: -1 | 0 | 1;
  /** CW quarter turn = cwSign·90° about +axis */
  readonly cwSign: 1 | -1;
  /** exact turn matrix applied to positions and (premultiplied to) orientations */
  readonly T: Mat3;
}

interface MoveSpec {
  axis: Axis;
  coord: -1 | 0 | 1;
  cwSign: 1 | -1;
}

const SPECS: Record<string, MoveSpec> = {
  U: { axis: 'y', coord: 1, cwSign: -1 },
  D: { axis: 'y', coord: -1, cwSign: 1 },
  R: { axis: 'x', coord: 1, cwSign: -1 },
  L: { axis: 'x', coord: -1, cwSign: 1 },
  F: { axis: 'z', coord: 1, cwSign: -1 },
  B: { axis: 'z', coord: -1, cwSign: 1 },
  M: { axis: 'x', coord: 0, cwSign: 1 },  // follows L
  E: { axis: 'y', coord: 0, cwSign: 1 },  // follows D
  S: { axis: 'z', coord: 0, cwSign: -1 }, // follows F
};

const AXIS_UNIT: Record<Axis, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export function axisUnit(axis: Axis): Vec3 {
  return AXIS_UNIT[axis];
}

function buildDef(base: string, quarterTurns: 1 | 2 | 3, suffix: '' | "'" | '2'): MoveDef {
  const spec = SPECS[base];
  if (!spec) throw new Error(`unknown move base: ${base}`);
  // turnMat(axis, normalSign, q): CW about outward normal. cwSign −1 ⇔
  // normalSign +1 (−90° about +axis); cwSign +1 ⇔ normalSign −1.
  const normalSign: 1 | -1 = spec.cwSign === -1 ? 1 : -1;
  const q: 1 | 2 | 3 = quarterTurns === 3 ? 1 : quarterTurns;
  // quarter 3 (prime) = CW about the OPPOSITE normal direction
  const effSign: 1 | -1 = quarterTurns === 3 ? ((normalSign * -1) as 1 | -1) : normalSign;
  return {
    token: `${base}${suffix}` as MoveToken,
    axis: spec.axis,
    coord: spec.coord,
    cwSign: spec.cwSign,
    T: turnMat(spec.axis, effSign, q),
  };
}

export const MOVE_TABLE: Readonly<Record<MoveToken, MoveDef>> = Object.freeze(
  Object.fromEntries(
    Object.keys(SPECS)
      .flatMap((base) => [
        buildDef(base, 1, ''),
        buildDef(base, 3, "'"),
        buildDef(base, 2, '2'),
      ])
      .map((def) => [def.token, def]),
  ) as Record<MoveToken, MoveDef>,
);

export function parseMove(token: string): MoveDef {
  const def = MOVE_TABLE[token as MoveToken];
  if (!def) throw new Error(`bad move token: ${token}`);
  return def;
}

export function inverseMove(token: MoveToken): MoveToken {
  if (token.endsWith('2')) return token;
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
  const cubies = state.cubies.map((c) => {
    if (c.pos[axisIndex(def.axis)] !== def.coord) return c; // shared reference
    return {
      ...c,
      pos: rotateVec(def.T, c.pos),
      R: mulOrient(def.T, c.R),
    } as Cubie;
  });
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

/** token for a CW/CCW/double turn of a given axis+coord, if one exists */
export function tokenFor(axis: Axis, coord: -1 | 0 | 1, quarters: 1 | 2 | 3): MoveToken {
  const want = quarters === 2 ? '2' : quarters === 3 ? "'" : '';
  for (const token of MOVE_TOKENS) {
    const def = MOVE_TABLE[token];
    if (def.axis === axis && def.coord === coord && token.slice(1) === want) return token;
  }
  throw new Error(`no token for ${axis}${coord}×${quarters}`);
}

// --- small local math (avoids importing mulMat's interning cost per cubie) --

function axisIndex(axis: Axis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

function rotateVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function mulOrient(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as number[];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return internMat(out as unknown as Mat3);
}
