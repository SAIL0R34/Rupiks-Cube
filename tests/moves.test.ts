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
} from '../src/core/moves';
import type { MoveToken } from '../src/core/moves';
import { generateScramble } from '../src/core/scramble';

const GROUP = rotationGroup();

describe('rotation group', () => {
  it('has exactly 24 members, all closed under multiplication', () => {
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
      const q2 = mulMat(q, q);
      const q4 = mulMat(q2, q2);
      expect(orientationIndex(q4)).toBe(orientationIndex(IDENTITY));
    }
  });

  it('is orthonormal: T·Tᵀ = I', () => {
    for (const m of GROUP) {
      const tt = mulMat(m, transpose(m));
      expect(tt).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
  });

  it('every face frame is right-handed (u × v = n) and normals are unique', () => {
    const normals = new Set(FACES.map((f) => FACE_FRAME[f].n.join(',')));
    expect(normals.size).toBe(6);
    for (const f of FACES) {
      const { n, uAxis, vAxis } = FACE_FRAME[f];
      expect(cross(uAxis, vAxis).map(normalizeZero)).toEqual([...n].map(normalizeZero));
      expect(faceOfNormal(n)).toBe(f);
    }
  });

  it('orientation indices round-trip', () => {
    for (const m of GROUP) {
      expect(orientationFromIndex(orientationIndex(m))).toBe(m);
    }
  });
});

describe('moves (P1/P2)', () => {
  const solved = createSolvedCube();

  it('P1: every move applied 4× returns to the original state exactly', () => {
    for (const token of MOVE_TOKENS) {
      let s = solved;
      for (let i = 0; i < 4; i++) s = applyMove(s, token);
      expect(s.cubies.map((c) => c.id + '@' + c.pos.join(','))).toEqual(
        solved.cubies.map((c) => c.id + '@' + c.pos.join(',')),
      );
      for (const c of s.cubies) {
        expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
      }
    }
  });

  it('P2: move then inverse = identity (all 18, including self-inverse doubles)', () => {
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

  it('R CW takes UFR → UBR (known permutation pins the sign convention)', () => {
    const s = applyMove(solved, 'R');
    const ufrId = solved.cubies.find((c) => c.pos.join(',') === '1,1,1')!.id;
    expect(s.cubies.find((c) => c.id === ufrId)!.pos.join(',')).toBe('1,1,-1');
  });

  it('F CW takes UFR → DFR', () => {
    const s = applyMove(solved, 'F');
    const ufrId = solved.cubies.find((c) => c.pos.join(',') === '1,1,1')!.id;
    expect(s.cubies.find((c) => c.id === ufrId)!.pos.join(',')).toBe('1,-1,1');
  });

  it('U CW viewed from above takes the front-top edge to the left side', () => {
    // U: n=+y, CW = Rot(−90°, y)
    const s = applyMove(solved, 'U');
    const ufId = solved.cubies.find((c) => c.pos.join(',') === '0,1,1')!.id;
    expect(s.cubies.find((c) => c.id === ufId)!.pos.join(',')).toBe('-1,1,0');
  });

  it('notation round-trips and MOVE_TABLE covers exactly 18 moves', () => {
    expect(MOVE_TOKENS.length).toBe(18);
    for (const token of MOVE_TOKENS) {
      expect(parseMove(token).token).toBe(token);
      expect(MOVE_TABLE[token].T.length).toBe(9);
    }
  });

  it('inverseSeq inverts a sequence', () => {
    const seq: MoveToken[] = ['R', 'U', "R'", 'U2'];
    const inv = inverseSeq(seq);
    expect(inv).toEqual(['U2', 'R', "U'", "R'"]);
    const s = applyMoves(applyMoves(solved, seq), inv);
    for (const c of s.cubies) expect(orientationIndex(c.R)).toBe(orientationIndex(IDENTITY));
  });

  it("cellCubiePos matches face frames (F(0,0) = bottom-left-front cubie)", () => {
    expect(cellCubiePos('F', 0, 0).join(',')).toBe('-1,-1,1');
    expect(cellCubiePos('U', 2, 2).join(',')).toBe('1,1,-1');
    expect(cellCubiePos('R', 0, 2).join(',')).toBe('1,1,1');
  });

  it('scrambles are deterministic and follow adjacency rules', () => {
    const a = generateScramble(42);
    const b = generateScramble(42);
    expect(a).toEqual(b);
    expect(a.length).toBe(25);
    for (let i = 1; i < a.length; i++) {
      expect(a[i][0]).not.toBe(a[i - 1][0]);
    }
  });

  it('cubieAt finds cubies by position', () => {
    expect(cubieAt(solved, [1, 1, 1])?.pos.join(',')).toBe('1,1,1');
    expect(cubieAt(solved, [0, 0, 0])).toBeUndefined();
  });
});

function cross(a: readonly number[], b: readonly number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalizeZero(x: number): number {
  return x === 0 ? 0 : x;
}

