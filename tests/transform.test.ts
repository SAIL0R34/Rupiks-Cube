import { describe, expect, it } from 'vitest';
import { createSolvedCube, checkInvariants, totalStrokePointCount, allStrokes } from '../src/core/cubeState';
import type { CubeState } from '../src/core/cubeState';
import { applyMoves } from '../src/core/moves';
import { faceToTile, tileToFace } from '../src/core/transform';
import { applyVec } from '../src/core/rotation';
import { FACE_FRAME, FACES } from '../src/core/faces';
import { splitPolylineOnFace, subStrokeLength } from '../src/core/strokeSplitter';
import type { MoveToken } from '../src/core/moves';
import { MOVE_TOKENS } from '../src/core/moves';
import { generateScramble } from '../src/core/scramble';
import { mulberry32 } from '../src/utils/rng';
import { polylineLength } from '../src/utils/geometry2d';

/** deterministic random state from a seed: solved + seeded scramble */
function scrambledState(seed: number): CubeState {
  return applyMoves(createSolvedCube(), generateScramble(seed));
}

describe('P5: face↔tile round-trip under arbitrary orientations', () => {
  it('round-trips for 60 scrambled states × all faces × all cells × random points', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const state = scrambledState(seed);
      const rng = mulberry32(seed * 7919);
      for (const face of FACES) {
        const frame = FACE_FRAME[face];
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cellPos = cellCubiePosStr(frame, i, j);
            const cellCubie = state.posIndex.get(cellPos)!;
            for (let k = 0; k < 3; k++) {
              const u = i + 0.05 + rng() * 0.9;
              const v = j + 0.05 + rng() * 0.9;
              const { sticker, s, t } = faceToTile(state, face, u, v);
              expect(s).toBeGreaterThanOrEqual(-1e-9);
              expect(s).toBeLessThanOrEqual(1 + 1e-9);
              expect(t).toBeGreaterThanOrEqual(-1e-9);
              expect(t).toBeLessThanOrEqual(1 + 1e-9);
              // the sticker must belong to this cell's cubie and face the face
              expect(sticker.cubieId).toBe(cellCubie.id);
              const w = applyVec(cellCubie.R, sticker.localNormal);
              expect([w[0], w[1], w[2]].map(z)).toEqual([...frame.n].map(z));
              // and the inverse map must recover the face coords
              const back = tileToFace(cellCubie, sticker, s, t);
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

function cellCubiePosStr(
  frame: (typeof FACE_FRAME)['F'],
  i: number,
  j: number,
): string {
  const pos = [
    (i - 1) * frame.uAxis[0] + (j - 1) * frame.vAxis[0] + frame.n[0],
    (i - 1) * frame.uAxis[1] + (j - 1) * frame.vAxis[1] + frame.n[1],
    (i - 1) * frame.uAxis[2] + (j - 1) * frame.vAxis[2] + frame.n[2],
  ];
  return pos.join(',');
}

/** normalize −0 → 0 for strict deep equality of integer vectors */
function z(x: number): number {
  return x === 0 ? 0 : x;
}

describe('strokeSplitter', () => {
  const state = createSolvedCube();

  it('a horizontal line crossing two vertical seams splits into three tiles', () => {
    const line = [0.5, 0.5, 2.5, 0.5];
    const subs = splitPolylineOnFace(state, 'F', line, { weight: 1, travel: false });
    expect(subs.length).toBe(3);
    const lens = subs.map(subStrokeLength).reduce((a, b) => a + b, 0);
    expect(Math.abs(lens - 2.0)).toBeLessThan(1e-9);
    // sub-stroke endpoints land exactly on the shared seams in tile coords
    expect(subs[0].pts[subs[0].pts.length - 2]).toBeCloseTo(1, 9);
    expect(subs[1].pts[0]).toBeCloseTo(0, 9);
    expect(subs[0].stickerId).not.toBe(subs[1].stickerId);
  });

  it('a diagonal crossing seams at different points splits into three tiles', () => {
    // crosses u=1 then v=1 at different parameters → cells (0,0),(1,0),(1,1)
    const diag = [0.2, 0.35, 1.7, 1.15];
    const subs = splitPolylineOnFace(state, 'F', diag, { weight: 0.7, travel: true });
    expect(subs.length).toBe(3);
    const lens = subs.map(subStrokeLength).reduce((a, b) => a + b, 0);
    expect(Math.abs(lens - Math.hypot(1.5, 0.8))).toBeLessThan(1e-9);
    expect(subs.every((s) => s.travel && s.weight === 0.7)).toBe(true);
  });

  it('a diagonal through a corner exactly touches only two cells', () => {
    // (0.25,0.25)→(1.75,1.75) passes through the grid vertex (1,1)
    const diag = [0.25, 0.25, 1.75, 1.75];
    const subs = splitPolylineOnFace(state, 'F', diag, { weight: 1, travel: false });
    expect(subs.length).toBe(2);
    const lens = subs.map(subStrokeLength).reduce((a, b) => a + b, 0);
    expect(Math.abs(lens - Math.hypot(1.5, 1.5))).toBeLessThan(1e-9);
  });

  it('a hatch endpoint exactly on a gridline resolves deterministically', () => {
    // ends exactly at u=1 moving right: the piece belongs to cell 0 up to the
    // seam; nothing spills into cell 1
    const hatch = [0.2, 1.0, 1.0, 1.0];
    const subs = splitPolylineOnFace(state, 'F', hatch, { weight: 1, travel: false });
    expect(subs.length).toBe(1);
    expect(subs[0].pts[subs[0].pts.length - 2]).toBeCloseTo(1, 9);
  });

  it('clips overshoot past the face border and conserves clipped length', () => {
    // starts outside the face (u=−0.5), enters at u=0 → visible length 1.5
    const line = [-0.5, 1.5, 1.5, 1.5];
    const subs = splitPolylineOnFace(state, 'F', line, { weight: 1, travel: false });
    expect(subs.length).toBe(2); // cells (0,1) and (1,1)
    const lens = subs.map(subStrokeLength).reduce((a, b) => a + b, 0);
    expect(Math.abs(lens - 1.5)).toBeLessThan(1e-9);
  });

  it('splits under scrambled orientations with length conservation (100 seeds)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const st = scrambledState(seed);
      const face = FACES[seed % 6];
      // random zigzag polyline
      const rng = mulberry32(seed * 31);
      const pts: number[] = [];
      for (let k = 0; k < 24; k++) pts.push(rng() * 3, rng() * 3);
      const subs = splitPolylineOnFace(st, face, pts, { weight: 1, travel: false });
      const total = subs.map(subStrokeLength).reduce((a, b) => a + b, 0);
      // full length is inside [0,3]² (random points are), so no clipping loss
      expect(Math.abs(total - polylineLength(pts))).toBeLessThan(1e-7);
      for (const s of subs) {
        expect(s.pts.length % 2).toBe(0);
        for (const p of s.pts) {
          expect(p).toBeGreaterThanOrEqual(-1e-9);
          expect(p).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('P3: stroke conservation across long scrambles', () => {
  it('strokes migrate with cubies but are never lost, duplicated, or mutated', () => {
    const rng = mulberry32(7);
    let state = createSolvedCube();
    // plant strokes via the real pipeline (splitter on face F)
    const subs = splitPolylineOnFace(state, 'F', [0.2, 0.2, 2.8, 2.8, 0.4, 2.2], { weight: 1, travel: false });
    attach(state, subs);
    const planted = countBySticker(state);
    const pointsBefore = totalStrokePointCount(state);
    const idsBefore = new Set(allStrokes(state).map((x) => x.stroke.id));

    for (let step = 0; step < 1000; step++) {
      const token = MOVE_TOKENS[Math.floor(rng() * MOVE_TOKENS.length)] as MoveToken;
      state = applyMoves(state, [token]);
    }
    checkInvariants(state);
    expect(totalStrokePointCount(state)).toBe(pointsBefore);
    const idsAfter = new Set(allStrokes(state).map((x) => x.stroke.id));
    expect(idsAfter.size).toBe(idsBefore.size);
    for (const id of idsBefore) expect(idsAfter.has(id)).toBe(true);
    // per-sticker counts unchanged (strokes stayed attached to their cubies)
    const after = countBySticker(state);
    expect(after).toEqual(planted);
  });
});

function attach(state: CubeState, subs: ReturnType<typeof splitPolylineOnFace>): void {
  for (const sub of subs) {
    const sticker = findSticker(state, sub.stickerId);
    sticker.strokes.push({
      id: sub.strokeId,
      pts: sub.pts.slice(),
      weight: sub.weight,
      travel: sub.travel,
      ...(sub.closed ? { closed: true } : {}),
    });
  }
}

function findSticker(state: CubeState, stickerId: number) {
  for (const c of state.cubies) {
    for (const s of c.stickers) if (s.id === stickerId) return s;
  }
  throw new Error(`sticker ${stickerId} not found`);
}

function countBySticker(state: CubeState): Array<{ stickerId: number; count: number }> {
  const out: Array<{ stickerId: number; count: number }> = [];
  for (const { stickerId, stroke } of allStrokes(state)) {
    void stroke;
    const last = out[out.length - 1];
    if (last && last.stickerId === stickerId) last.count++;
    else out.push({ stickerId, count: 1 });
  }
  return out;
}
