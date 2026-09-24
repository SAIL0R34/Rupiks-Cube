/**
 * Seeded scramble generator: WCA-ish rules — 25 moves, no same-face repeats,
 * no A-B-A on a shared axis.
 */

import { MOVE_TOKENS } from './moves';
import type { MoveToken } from './moves';
import { FACE_FRAME } from './faces';
import type { Face } from './faces';
import { mulberry32, randomInt } from '../utils/rng';

const FACE_BY_TOKEN = new Map(MOVE_TOKENS.map((t) => [t, t.slice(0, 1) as Face]));

function faceAxis(face: Face): 'x' | 'y' | 'z' {
  const n = FACE_FRAME[face].n;
  if (n[0] !== 0) return 'x';
  if (n[1] !== 0) return 'y';
  return 'z';
}

export function generateScramble(seed: number, length = 25): MoveToken[] {
  const rng = mulberry32(seed);
  const out: MoveToken[] = [];
  let prevFace: Face | null = null;
  let prevPrevFace: Face | null = null;
  while (out.length < length) {
    const token = MOVE_TOKENS[randomInt(rng, MOVE_TOKENS.length)];
    const face = FACE_BY_TOKEN.get(token)!;
    if (face === prevFace) continue;
    if (
      prevFace !== null &&
      prevPrevFace !== null &&
      face === prevPrevFace &&
      faceAxis(face) === faceAxis(prevFace)
    ) {
      continue; // A B A on the same axis
    }
    out.push(token);
    prevPrevFace = prevFace;
    prevFace = face;
  }
  return out;
}
