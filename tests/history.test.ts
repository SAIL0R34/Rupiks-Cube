/** P7-history + reference semantics for the photo cube */

import { describe, expect, it } from 'vitest';
import { createSolvedCube, cubeStatesEqual } from '../src/core/cubeState';
import {
  applyCommandEffect,
  undoCommandEffect,
  snapshotReference,
  matchesReference,
  movesSinceReference,
  inverseOf,
  createSession,
  MAX_HISTORY,
} from '../src/core/history';
import type { Session, Command } from '../src/core/history';
import { generateScramble } from '../src/core/scramble';
import { pick } from '../src/utils/rng';
import { mulberry32 } from '../src/utils/rng';
import { applyMoves } from '../src/core/moves';
import type { CubeState } from '../src/core/cubeState';

function freshSession(): Session {
  return createSession();
}

function sessionSig(s: Session): string {
  const tiles = [...s.tiles.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`);
  return JSON.stringify([
    s.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}@${c.R.join(',')}`),
    s.log,
    tiles,
    s.paintVersion,
    s.reference ? [s.reference.logLength, s.reference.paintVersion, s.reference.poses] : null,
  ]);
}

/** paint 9 tiles of face F with marker strings (stand-in for image dataURLs) */
function paintFace(sess: Session, marker: string, face = 'F'): Command {
  const items = faceStickerIds(sess.cube, face).map((id) => ({
    stickerId: id,
    before: sess.tiles.get(id) ?? null,
    after: `${marker}#${id}`,
  }));
  return { kind: 'setTiles', items };
}

function faceStickerIds(cube: CubeState, face: string): number[] {
  const n = face === 'U' ? [0, 1, 0] : face === 'D' ? [0, -1, 0] : face === 'L' ? [-1, 0, 0]
    : face === 'R' ? [1, 0, 0] : face === 'B' ? [0, 0, -1] : [0, 0, 1];
  const out: number[] = [];
  for (const c of cube.cubies) {
    if (c.pos[0] * n[0] + c.pos[1] * n[1] + c.pos[2] * n[2] !== 1) continue;
    for (const s of c.stickers) {
      const R = c.R;
      const ln = s.localNormal;
      const w = [
        R[0] * ln[0] + R[1] * ln[1] + R[2] * ln[2],
        R[3] * ln[0] + R[4] * ln[1] + R[5] * ln[2],
        R[6] * ln[0] + R[7] * ln[1] + R[8] * ln[2],
      ];
      if (w[0] === n[0] && w[1] === n[1] && w[2] === n[2]) out.push(s.id);
    }
  }
  return out;
}

describe('P7: history round-trip (photo cube commands)', () => {
  it('random walks of moves + paints + references undo to the exact initial state', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 131);
      const sess = freshSession();
      const initialSig = sessionSig(sess);
      const stack: Command[] = [];

      const steps = 8 + Math.floor(rng() * 8);
      for (let i = 0; i < steps; i++) {
        const roll = rng();
        let cmd: Command;
        if (roll < 0.45) {
          cmd = { kind: 'moves', tokens: generateScramble(seed * 1000 + i, 2 + Math.floor(rng() * 5)) };
        } else if (roll < 0.85) {
          cmd = paintFace(sess, `paint-${seed}-${i}`, pick(rng, ['F', 'R', 'U'] as const));
        } else {
          cmd = {
            kind: 'setReference',
            prev: sess.reference,
            next: snapshotReference(sess),
          };
        }
        applyCommandEffect(sess, cmd);
        stack.push(cmd);
      }

      while (stack.length > 0) {
        undoCommandEffect(sess, stack.pop()!);
      }
      expect(sessionSig(sess)).toBe(initialSig);
    }
  });

  it('undoing a paint works across a later scramble (sticker-id addressing)', () => {
    const sess = freshSession();
    const paint = paintFace(sess, 'photo');
    applyCommandEffect(sess, paint);
    const scramble = generateScramble(77, 20);
    applyCommandEffect(sess, { kind: 'moves', tokens: scramble });

    undoCommandEffect(sess, { kind: 'moves', tokens: scramble });
    undoCommandEffect(sess, paint);
    expect(sess.tiles.size).toBe(0);
    expect(sess.paintVersion).toBe(0);
  });

  it('reference + solve tail semantics', () => {
    const sess = freshSession();
    applyCommandEffect(sess, paintFace(sess, 'a'));
    applyCommandEffect(sess, paintFace(sess, 'b', 'R'));
    sess.reference = snapshotReference(sess);
    applyCommandEffect(sess, { kind: 'moves', tokens: generateScramble(5, 15) });

    expect(matchesReference(sess, sess.reference)).toBe(false);
    expect(movesSinceReference(sess).length).toBe(15);

    for (const t of inverseOf(movesSinceReference(sess))) {
      applyCommandEffect(sess, { kind: 'moves', tokens: [t] });
    }
    expect(matchesReference(sess, sess.reference)).toBe(true);

    // a repaint after the reference breaks "solved" (paintVersion)
    applyCommandEffect(sess, paintFace(sess, 'c', 'U'));
    expect(matchesReference(sess, sess.reference)).toBe(false);
  });

  it('MAX_HISTORY is a sane cap', () => {
    expect(MAX_HISTORY).toBe(200);
  });

  it('solved-cube pose equality sanity', () => {
    expect(cubeStatesEqual(createSolvedCube(), createSolvedCube())).toBe(true);
    expect(cubeStatesEqual(createSolvedCube(), applyMoves(createSolvedCube(), ['R']))).toBe(false);
  });
});
