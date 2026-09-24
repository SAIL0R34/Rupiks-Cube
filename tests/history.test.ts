import { describe, expect, it } from 'vitest';
import { createSolvedCube, cubeStatesEqual, allStrokes, checkInvariants } from '../src/core/cubeState';
import {
  applyCommandEffect,
  undoCommandEffect,
  snapshotReference,
  matchesReference,
  movesSinceReference,
  inverseOf,
  MAX_HISTORY,
} from '../src/core/history';
import type { Session, Command, StrokeItem } from '../src/core/history';
import { generateScramble } from '../src/core/scramble';
import { MOVE_TOKENS } from '../src/core/moves';
import type { MoveToken } from '../src/core/moves';
import { splitPolylineOnFace } from '../src/core/strokeSplitter';
import { mulberry32, pick } from '../src/utils/rng';

function freshSession(): Session {
  return { cube: createSolvedCube(), log: [], reference: null };
}

function refSig(s: Session): string {
  if (!s.reference) return 'null';
  return JSON.stringify([s.reference.logLength, s.reference.strokeIds, s.reference.poses]);
}

/** deep session equality for the P7 gate */
function sessionsEqual(a: Session, b: Session): boolean {
  return (
    cubeStatesEqual(a.cube, b.cube) &&
    JSON.stringify(a.log) === JSON.stringify(b.log) &&
    refSig(a) === refSig(b)
  );
}

function randomDrawCommand(sess: Session, rng: () => number): Command {
  const faces = ['F', 'R', 'U', 'B', 'L', 'D'] as const;
  const face = pick(rng, faces);
  const pts: number[] = [];
  const n = 3 + Math.floor(rng() * 8);
  for (let i = 0; i < n; i++) pts.push(rng() * 3, rng() * 3);
  const subs = splitPolylineOnFace(sess.cube, face, pts, { weight: rng(), travel: false });
  const items: StrokeItem[] = subs.map((sub) => ({
    stickerId: sub.stickerId,
    stroke: {
      id: sub.strokeId,
      pts: sub.pts,
      weight: sub.weight,
      travel: sub.travel,
      ...(sub.closed ? { closed: true } : {}),
    },
  }));
  return { kind: 'addStrokes', items };
}

describe('P7: history round-trip', () => {
  it('random command walks undo back to the exact initial state', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 131);
      const sess = freshSession();
      const initial = { cube: sess.cube, log: [] as MoveToken[], reference: null } as Session;
      const stack: Command[] = [];

      const steps = 10 + Math.floor(rng() * 10);
      for (let i = 0; i < steps; i++) {
        const roll = rng();
        let cmd: Command;
        if (roll < 0.4) {
          const tokens = generateScramble(seed * 1000 + i, 3 + Math.floor(rng() * 6));
          cmd = { kind: 'moves', tokens };
        } else if (roll < 0.8) {
          cmd = randomDrawCommand(sess, rng);
        } else if (roll < 0.9) {
          // clear some strokes (removeStrokes)
          const strokes = allStrokes(sess.cube);
          if (strokes.length === 0) continue;
          const victim = pick(rng, strokes);
          cmd = { kind: 'removeStrokes', items: [{ stickerId: victim.stickerId, stroke: victim.stroke }] };
        } else {
          cmd = {
            kind: 'setReference',
            prev: sess.reference,
            next: snapshotReference(sess.cube, sess.log.length),
          };
        }
        applyCommandEffect(sess, cmd);
        stack.push(cmd);
        checkInvariants(sess.cube);
      }

      // undo everything in LIFO order
      while (stack.length > 0) {
        undoCommandEffect(sess, stack.pop()!);
      }
      expect(sessionsEqual(sess, initial)).toBe(true);

      // redo everything again in order
      // (stack was popped; rebuild by re-applying — redo semantics equal
      // applyCommandEffect in original order)
    }
  });

  it('redo path: apply → undo → apply again is stable', () => {
    const sess = freshSession();
    const draw = randomDrawCommand(sess, mulberry32(9));
    applyCommandEffect(sess, draw);
    const afterApply = { ...sess, cube: sess.cube } as Session;
    undoCommandEffect(sess, draw);
    expect(allStrokes(sess.cube).length).toBe(0);
    applyCommandEffect(sess, draw);
    expect(cubeStatesEqual(sess.cube, afterApply.cube)).toBe(true);
  });

  it('undoing a stroke batch works across a subsequent scramble (id addressing)', () => {
    const sess = freshSession();
    const draw = randomDrawCommand(sess, mulberry32(21));
    applyCommandEffect(sess, draw);
    const drawnIds = draw.kind === 'addStrokes' ? draw.items.map((i) => i.stroke.id) : [];
    expect(drawnIds.length).toBeGreaterThan(0);

    const scramble = generateScramble(77, 25);
    applyCommandEffect(sess, { kind: 'moves', tokens: scramble });

    // strokes still exist, wherever they rode
    const liveIds = new Set(allStrokes(sess.cube).map((x) => x.stroke.id));
    for (const id of drawnIds) expect(liveIds.has(id)).toBe(true);

    // undo the scramble first (LIFO), then the stroke batch
    undoCommandEffect(sess, { kind: 'moves', tokens: scramble });
    undoCommandEffect(sess, draw);
    expect(allStrokes(sess.cube).length).toBe(0);
  });

  it('reference + solve tail semantics', () => {
    const sess = freshSession();
    applyCommandEffect(sess, randomDrawCommand(sess, mulberry32(5)));
    sess.reference = snapshotReference(sess.cube, sess.log.length);
    const scramble = generateScramble(123, 20);
    applyCommandEffect(sess, { kind: 'moves', tokens: scramble });

    expect(matchesReference(sess.cube, sess.reference)).toBe(false);
    expect(movesSinceReference(sess).length).toBe(20);

    // solving = replaying the inverse of the tail
    const inverse = inverseOf(movesSinceReference(sess));
    for (const t of inverse) applyCommandEffect(sess, { kind: 'moves', tokens: [t] });
    expect(matchesReference(sess.cube, sess.reference)).toBe(true);
    // after truncating the log to the reference point, solve is a no-op
    sess.log.length = sess.reference.logLength;
    expect(movesSinceReference(sess).length).toBe(0);
  });

  it('all 18 tokens survive an apply/undo round trip', () => {
    for (const token of MOVE_TOKENS) {
      const sess = freshSession();
      const solved = sess.cube;
      applyCommandEffect(sess, { kind: 'moves', tokens: [token] });
      undoCommandEffect(sess, { kind: 'moves', tokens: [token] });
      expect(cubeStatesEqual(sess.cube, solved)).toBe(true);
      expect(sess.log.length).toBe(0);
    }
  });

  it('MAX_HISTORY is a sane cap', () => {
    expect(MAX_HISTORY).toBe(200);
  });
});
