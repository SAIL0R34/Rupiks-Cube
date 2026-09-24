/**
 * P5 (transform round-trip) + P3-photo (tile-image identity conservation) +
 * blit corner-math — the geometry gates for the photo cube.
 */

import { describe, expect, it } from 'vitest';
import { createSolvedCube, checkInvariants } from '../src/core/cubeState';
import { applyMoves } from '../src/core/moves';
import { faceCellAffines } from '../src/imaging/faceBlit';
import { faceToTile as f2t, tileToFace as t2f } from '../src/core/transform';
import { FACE_FRAME, FACES } from '../src/core/faces';
import { generateScramble } from '../src/core/scramble';
import { mulberry32 } from '../src/utils/rng';
import { createSession } from '../src/core/history';
import { applyVec } from '../src/core/rotation';
import type { CubeState } from '../src/core/cubeState';

function scrambledState(seed: number): CubeState {
  return applyMoves(createSolvedCube(), generateScramble(seed));
}

describe('P5: face↔tile round-trip under arbitrary orientations', () => {
  it('round-trips for 40 scrambled states × all faces × all cells', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = scrambledState(seed);
      const rng = mulberry32(seed * 7919);
      for (const face of FACES) {
        const frame = FACE_FRAME[face];
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cellPos = [
              (i - 1) * frame.uAxis[0] + (j - 1) * frame.vAxis[0] + frame.n[0],
              (i - 1) * frame.uAxis[1] + (j - 1) * frame.vAxis[1] + frame.n[1],
              (i - 1) * frame.uAxis[2] + (j - 1) * frame.vAxis[2] + frame.n[2],
            ].join(',');
            const cellCubie = state.posIndex.get(cellPos)!;
            for (let k = 0; k < 3; k++) {
              const u = i + 0.05 + rng() * 0.9;
              const v = j + 0.05 + rng() * 0.9;
              const { sticker, s, t } = f2t(state, face, u, v);
              expect(s).toBeGreaterThanOrEqual(-1e-9);
              expect(s).toBeLessThanOrEqual(1 + 1e-9);
              expect(t).toBeGreaterThanOrEqual(-1e-9);
              expect(t).toBeLessThanOrEqual(1 + 1e-9);
              expect(sticker.cubieId).toBe(cellCubie.id);
              const w = applyVec(cellCubie.R, sticker.localNormal);
              expect([w[0], w[1], w[2]].map(nz)).toEqual([...frame.n].map(nz));
              const back = t2f(cellCubie, sticker, s, t);
              expect(back.face).toBe(face);
              expect(Math.abs(back.u - u)).toBeLessThan(1e-9);
              expect(Math.abs(back.v - v)).toBeLessThan(1e-9);
            }
          }
        }
      }
    }
  });
});

function nz(x: number): number {
  return x === 0 ? 0 : x;
}

describe('blit corner math', () => {
  it('solved state: every face-cell quad is the identity unit square', () => {
    const state = createSolvedCube();
    for (const face of FACES) {
      const affines = faceCellAffines(state, face);
      expect(affines.length).toBe(9);
      for (const a of affines) {
        expect(a.quad).toEqual([
          { s: 0, t: 0 },
          { s: 1, t: 0 },
          { s: 1, t: 1 },
          { s: 0, t: 1 },
        ]);
      }
    }
  });

  it('after turns: quads are exact rotations of the unit square (no flips)', () => {
    const state = applyMoves(createSolvedCube(), ['R', 'U', "F'", 'M', 'E2', 'S']);
    for (const face of FACES) {
      for (const a of faceCellAffines(state, face)) {
        const pts = a.quad.map((q) => `${q.s.toFixed(6)},${q.t.toFixed(6)}`);
        const unit = ['0.000000,0.000000', '1.000000,0.000000', '1.000000,1.000000', '0.000000,1.000000'];
        // each quad is some rotation of the unit square corners
        for (let r = 0; r < 4; r++) {
          if (pts.every((p, idx) => p === unit[(idx + r) % 4])) {
            expect(true).toBe(true);
            break;
          }
          if (r === 3) throw new Error(`quad not a rotation: ${pts.join(' | ')}`);
        }
      }
    }
  });

  it('affines address exactly the 9 stickers currently facing each face', () => {
    const state = scrambledState(9);
    for (const face of FACES) {
      const n = FACE_FRAME[face].n;
      const ids = new Set(faceCellAffines(state, face).map((a) => a.stickerId));
      expect(ids.size).toBe(9);
      for (const c of state.cubies) {
        for (const s of c.stickers) {
          const w = applyVec(c.R, s.localNormal).map(nz);
          const onFace = w[0] === n[0] && w[1] === n[1] && w[2] === n[2];
          expect(ids.has(s.id)).toBe(onFace);
        }
      }
    }
  });
});

describe('P3-photo: tile image identity is conserved across scrambles', () => {
  it('tile assignments never change through 1000 moves (they only migrate)', () => {
    const sess = createSession();
    // paint a unique marker per sticker
    for (const c of sess.cube.cubies) {
      for (const s of c.stickers) {
        sess.tiles.set(s.id, `img#${s.id}`);
      }
    }
    const before = new Map(sess.tiles);
    const rng = mulberry32(7);
    const tokens = generateScramble(101, 25);
    let cube = sess.cube;
    for (let step = 0; step < 1000; step++) {
      cube = applyMoves(cube, [tokens[Math.floor(rng() * tokens.length)]]);
    }
    checkInvariants(cube);
    expect(sess.tiles).toEqual(before); // untouched by moves, as designed
    // and every sticker id still exists on the cube
    const ids = new Set(cube.cubies.flatMap((c) => c.stickers.map((s) => s.id)));
    for (const id of before.keys()) expect(ids.has(id)).toBe(true);
  });
});
