import { describe, expect, it } from 'vitest';
import {
  rotationGroup,
  mulMat,
  orientationFromIndex,
  orientationIndex,
  transpose,
  IDENTITY,
  AXIS_CW,
  AXIS_CCW,
} from '../src/core/rotation';
import { FACE_FRAME, FACES, cellCubiePos, faceOfNormal } from '../src/core/faces';
import { createSolvedCube, cubieAt } from '../src/core/cubeState';
import { applyMoves } from '../src/core/moves';
import {
  MOVE_TOKENS,
  MOVE_TABLE,
  inverseMove,
  inverseSeq,
  applyMove,
  parseMove,
  tokenFor,
} from '../src/core/moves';
import type { MoveToken } from '../src/core/moves';
import { generateScramble } from '../src/core/scramble';

const GROUP = rotationGroup();

function cross(a: readonly number[], b: readonly number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function z(x: number): number {
  return x === 0 ? 0 : x;
}

describe('rotation group', () => {
  it('has exactly 24 members, closed under multiplication', () => {
    expect(GROUP.length).toBe(24);
    for (const a of GROUP) {
      for (const b of GROUP) {
        expect(orientationIndex(mulMat(a, b))).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('T⁴ = I for all six quarter-turn generators', () => {
    const quarters = [...Object.values(AXIS_CW), ...Object.values(AXIS_CCW)];
    for (const q of quarters) {
      expect(orientationIndex(mulMat(mulMat(q, q), mulMat(q, q)))).toBe(orientationIndex(IDENTITY));
    }
  });

  it('is orthonormal: T·Tᵀ = I', () => {
    for (const m of GROUP) {
      expect(mulMat(m, transpose(m))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
  });

  it('face frames are right-handed (u × v = n) with unique normals', () => {
    const normals = new Set(FACES.map((f) => FACE_FRAME[f].n.join(',')));
    expect(normals.size).toBe(6);
    for (const f of FACES) {
      const { n, uAxis, vAxis } = FACE_FRAME[f];
      expect(cross(uAxis, vAxis).map(z)).toEqual([...n].map(z));
      expect(faceOfNormal(n)).toBe(f);
    }
  });

  it('orientation indices round-trip', () => {
    for (const m of GROUP) {
      expect(orientationFromIndex(orientationIndex(m))).toBe(m);
    }
  });
});

describe('moves (P1/P2) — 24 tokens incl. middle slices', () => {
  const solved = createSolvedCube();

  it('covers exactly 27 tokens (9 bases × 3) with axis/coord/cwSign defined', () => {
    expect(MOVE_TOKENS.length).toBe(27);
    for (const token of MOVE_TOKENS) {
      const def = parseMove(token);
      expect(def.token).toBe(token);
      expect([-1, 0, 1]).toContain(def.coord);
      expect([1, -1]).toContain(def.cwSign);
    }
  });

  it('P1: every move applied 4× returns to the original state exactly', () => {
    for (const token of MOVE_TOKENS) {
      let s = solved;
      for (let i = 0; i < 4; i++) s = applyMove(s, token);
      expect(s.cubies.map((c) => c.id + '@' + c.pos.join(',')).join(';')).toBe(
        solved.cubies.map((c) => c.id + '@' + c.pos.join(',')).join(';'),
      );
      for (const c of s.cubies) expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
    }
  });

  it('P2: move then inverse = identity (all 24, incl. self-inverse doubles)', () => {
    for (const token of MOVE_TOKENS) {
      const s = applyMove(applyMove(solved, token), inverseMove(token));
      expect(s.cubies.map((c) => c.id + '@' + c.pos.join(',')).join(';')).toBe(
        solved.cubies.map((c) => c.id + '@' + c.pos.join(',')).join(';'),
      );
      for (const c of s.cubies) expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
    }
  });

  it("(R U R' U')⁶ = identity — premultiplication order regression", () => {
    let s = solved;
    for (let i = 0; i < 6; i++) s = applyMoves(s, ['R', 'U', "R'", "U'"]);
    for (const c of s.cubies) {
      expect(c.pos.join(',')).toBe(solved.cubies.find((o) => o.id === c.id)!.pos.join(','));
      expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
    }
  });

  it('R CW takes UFR → UBR (sign convention pin)', () => {
    const s = applyMove(solved, 'R');
    const ufrId = solved.cubies.find((c) => c.pos.join(',') === '1,1,1')!.id;
    expect(s.cubies.find((c) => c.id === ufrId)!.pos.join(',')).toBe('1,1,-1');
  });

  it('F CW takes UFR → DFR', () => {
    const s = applyMove(solved, 'F');
    const ufrId = solved.cubies.find((c) => c.pos.join(',') === '1,1,1')!.id;
    expect(s.cubies.find((c) => c.id === ufrId)!.pos.join(',')).toBe('1,-1,1');
  });

  it('slices follow their reference faces: M~L, E~D, S~F (identical turn matrices)', () => {
    expect(MOVE_TABLE.M.T).toBe(MOVE_TABLE.L.T);
    expect(MOVE_TABLE.E.T).toBe(MOVE_TABLE.D.T);
    expect(MOVE_TABLE.S.T).toBe(MOVE_TABLE.F.T);
  });

  it('M moves the middle slice like L moves its layer, and leaves outer layers alone', () => {
    const sM = applyMove(solved, 'M');
    const sL = applyMove(solved, 'L');
    const midId = solved.cubies.find((c) => c.pos.join(',') === '0,1,0')!.id;
    const wingId = solved.cubies.find((c) => c.pos.join(',') === '-1,1,0')!.id;
    const ufrId = solved.cubies.find((c) => c.pos.join(',') === '1,1,1')!.id;
    // same y/z displacement, differing only in the x coordinate
    const m = sM.cubies.find((c) => c.id === midId)!.pos;
    const w = sL.cubies.find((c) => c.id === wingId)!.pos;
    expect(`${m[1]},${m[2]}`).toBe(`${w[1]},${w[2]}`);
    // outer-layer cubie untouched by M
    expect(sM.cubies.find((c) => c.id === ufrId)!.pos.join(',')).toBe('1,1,1');
  });

  it("S follows F on the middle slice", () => {
    const s = applyMove(solved, 'S');
    const midId = solved.cubies.find((c) => c.pos.join(',') === '0,1,0')!.id;
    // F CW takes (0,1,·)→(1,0,·); the S slice must match on its own cubie
    const p = s.cubies.find((c) => c.id === midId)!.pos;
    expect(`${p[0]},${p[1]}`).toBe('1,0');
  });

  it('tokenFor resolves every axis/coord/direction and matches MOVE_TABLE', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const coord of [-1, 0, 1] as const) {
        const cw = tokenFor(axis, coord, 1);
        const ccw = tokenFor(axis, coord, 3);
        expect(MOVE_TABLE[cw].axis).toBe(axis);
        expect(MOVE_TABLE[cw].coord).toBe(coord);
        expect(inverseMove(cw)).toBe(ccw);
        expect(inverseMove(ccw)).toBe(cw);
        expect(tokenFor(axis, coord, 2).endsWith('2')).toBe(true);
        expect(inverseMove(tokenFor(axis, coord, 2))).toBe(tokenFor(axis, coord, 2));
      }
    }
  });

  it('inverseSeq inverts a sequence', () => {
    const seq: MoveToken[] = ['R', 'U', "M'", 'U2'];
    const s = applyMoves(applyMoves(solved, seq), inverseSeq(seq));
    for (const c of s.cubies) expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
  });

  it("cellCubiePos matches face frames", () => {
    expect(cellCubiePos('F', 0, 0).join(',')).toBe('-1,-1,1');
    expect(cellCubiePos('U', 2, 2).join(',')).toBe('1,1,-1');
    expect(cellCubiePos('R', 0, 2).join(',')).toBe('1,1,1');
  });

  it('scrambles are deterministic with no same-face adjacency', () => {
    const a = generateScramble(42);
    expect(a).toEqual(generateScramble(42));
    expect(a.length).toBe(25);
    for (let i = 1; i < a.length; i++) expect(a[i][0]).not.toBe(a[i - 1][0]);
  });

  it('cubieAt finds cubies by position', () => {
    expect(cubieAt(solved, [1, 1, 1])?.pos.join(',')).toBe('1,1,1');
    expect(cubieAt(solved, [0, 0, 0])).toBeUndefined();
  });
});
