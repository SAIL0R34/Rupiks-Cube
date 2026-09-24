/** P8: photo-cube save/session round trips */

import { describe, expect, it } from 'vitest';
import { applyMoves } from '../src/core/moves';
import {
  serializeSave,
  deserializeSave,
  serializeSession,
  deserializeSession,
} from '../src/core/serialize';
import { createSession, snapshotReference } from '../src/core/history';
import type { Session, Command } from '../src/core/history';
import { generateScramble } from '../src/core/scramble';

function seededPhotoSession(seed: number): Session {
  const sess = createSession();
  const tokens = generateScramble(seed, 8);
  const cube = applyMoves(sess.cube, tokens);
  sess.cube = cube;
  sess.log.push(...tokens);
  for (const c of cube.cubies) {
    for (const s of c.stickers) {
      if ((s.id + seed) % 3 === 0) sess.tiles.set(s.id, `data:image/jpeg;base64,marker${s.id}`);
    }
  }
  for (const f of ['U', 'D', 'L', 'R', 'F', 'B'] as const) {
    sess.images[f] = `data:image/jpeg;base64,face${f}${seed}`;
  }
  sess.reference = snapshotReference(sess);
  return sess;
}

describe('P8: save file v2 round trip', () => {
  it('preserves poses, log, tiles, images, reference, paintVersion exactly', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sess = seededPhotoSession(seed);
      const wire = serializeSave(sess);
      const back = deserializeSave(JSON.parse(JSON.stringify(wire)));
      expect(
        back.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}@${c.R.join(',')}`).join(';'),
      ).toBe(sess.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}@${c.R.join(',')}`).join(';'));
      expect(back.log).toEqual(sess.log);
      expect([...back.tiles.entries()].sort()).toEqual([...sess.tiles.entries()].sort());
      expect(back.images).toEqual(sess.images);
      expect(back.paintVersion).toBe(sess.paintVersion);
      // JSON-string compare: reference poses can contain −0, which a JSON
      // round trip normalizes to 0 (vitest toEqual distinguishes them)
      expect(JSON.stringify(back.reference)).toBe(JSON.stringify(sess.reference));
    }
  });

  it('rejects foreign or future formats', () => {
    expect(() => deserializeSave({ format: 'nope', version: 9 } as never)).toThrow();
    expect(() =>
      deserializeSave({ format: 'twistdraw-cube/save', version: 1 } as never),
    ).toThrow();
  });
});

describe('P9: session v2 round trip', () => {
  it('preserves undo/redo stacks', () => {
    const sess = seededPhotoSession(4);
    const undo: Command[] = [
      { kind: 'moves', tokens: ['R', 'U'] },
      { kind: 'setTiles', items: [{ stickerId: 3, before: null, after: 'data:img' }] },
      { kind: 'setReference', prev: null, next: sess.reference },
    ];
    const redo: Command[] = [{ kind: 'moves', tokens: ["M'"] }];
    const wire = serializeSession(sess, undo, redo);
    const back = deserializeSession(JSON.parse(JSON.stringify(wire)));
    expect(JSON.stringify(back.undoStack)).toBe(JSON.stringify(undo));
    expect(JSON.stringify(back.redoStack)).toBe(JSON.stringify(redo));
    expect(
      back.session.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}`).join(';'),
    ).toBe(sess.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}`).join(';'));
    expect([...back.session.tiles.entries()].sort()).toEqual([...sess.tiles.entries()].sort());
  });

  it('save→load→save is stable', () => {
    const sess = seededPhotoSession(21);
    const once = serializeSave(sess);
    const back = deserializeSave(JSON.parse(JSON.stringify(once)));
    const twice = serializeSave(back);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
