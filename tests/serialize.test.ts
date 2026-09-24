import { describe, expect, it } from 'vitest';
import { createSolvedCube, cubeStatesEqual, allStrokes } from '../src/core/cubeState';
import { applyMoves } from '../src/core/moves';
import {
  serializeSave,
  deserializeSave,
  serializeSession,
  deserializeSession,
  serializePlot,
  hydratePlot,
} from '../src/core/serialize';
import type { Session, Command, StrokeItem } from '../src/core/history';
import { snapshotReference } from '../src/core/history';
import { generateScramble } from '../src/core/scramble';
import { splitPolylineOnFace } from '../src/core/strokeSplitter';
import { mapPlanToFace } from '../src/plotting/planMapper';
import { peekStrokeIdHi } from '../src/core/stickers';

function seededArtSession(seed: number): Session {
  const cube = applyMoves(createSolvedCube(), generateScramble(seed));
  const sess: Session = { cube, log: generateScramble(seed), reference: null };
  // plant strokes through the real splitter on a couple of faces
  for (const face of ['F', 'R', 'U'] as const) {
    const subs = splitPolylineOnFace(
      sess.cube,
      face,
      [0.2 + (seed % 5) / 10, 0.3, 2.7, 2.6, 0.5, 2.2, 2.9, 0.4],
      { weight: 0.8, travel: false },
    );
    for (const sub of subs) {
      const sticker = sess.cube.cubies.flatMap((c) => c.stickers).find((s) => s.id === sub.stickerId)!;
      sticker.strokes.push({
        id: sub.strokeId,
        pts: sub.pts,
        weight: sub.weight,
        travel: sub.travel,
        ...(sub.closed ? { closed: true } : {}),
      });
    }
  }
  sess.reference = snapshotReference(sess.cube, sess.log.length);
  return sess;
}

/** strokes differ only within u8 quantization (≤ 1/255 per coordinate) */
function strokesClose(a: Session, b: Session): boolean {
  const sa = allStrokes(a.cube);
  const sb = allStrokes(b.cube);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].stroke.id !== sb[i].stroke.id) return false;
    if (sa[i].stickerId !== sb[i].stickerId) return false;
    if (sa[i].stroke.pts.length !== sb[i].stroke.pts.length) return false;
    for (let p = 0; p < sa[i].stroke.pts.length; p++) {
      if (Math.abs(sa[i].stroke.pts[p] - sb[i].stroke.pts[p]) > 1 / 255 + 1e-9) return false;
    }
  }
  return true;
}

describe('P8: save file round trip', () => {
  it('preserves poses, log, reference; strokes within quantization', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sess = seededArtSession(seed);
      const wire = serializeSave(sess);
      const back = deserializeSave(JSON.parse(JSON.stringify(wire)));
      // exact pose equality
      expect(
        back.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}@${c.R.join(',')}`).join(';'),
      ).toBe(sess.cube.cubies.map((c) => `${c.id}@${c.pos.join(',')}@${c.R.join(',')}`).join(';'));
      expect(back.log).toEqual(sess.log);
      expect(back.reference?.logLength).toBe(sess.reference?.logLength);
      expect(back.reference?.strokeIds).toEqual(sess.reference?.strokeIds);
      expect(strokesClose(sess, back)).toBe(true);
    }
  });

  it('rejects foreign/future formats', () => {
    expect(() => deserializeSave({ format: 'nope', version: 9 } as never)).toThrow();
    expect(() =>
      deserializeSave({ format: 'twistdraw-cube/save', version: 99 } as never),
    ).toThrow();
  });
});

describe('P9: session round trip', () => {
  it('preserves undo/redo stacks, ui state, and a mid-flight plot', () => {
    const sess = seededArtSession(4);
    const items = allStrokes(sess.cube).slice(0, 1).map((x) => ({
      stickerId: x.stickerId,
      stroke: x.stroke,
    })) as StrokeItem[];
    const undoStack: Command[] = [
      { kind: 'moves', tokens: ['R', 'U'] },
      {
        kind: 'addStrokes',
        items: allStrokes(sess.cube).slice(0, 2).map((x) => ({
          stickerId: x.stickerId,
          stroke: x.stroke,
        })) as StrokeItem[],
      },
    ];
    const ui = {
      activeFace: 'R',
      turnFace: 'U',
      mode: 'pen',
      penDown: true,
      speed: 4,
      complexity: 'obsessed',
      cursor: { u: 1.25, v: 2.5, visible: true },
    };
    // a mapped plan with quantizable coords
    const plan = mapPlanToFace({
      polys: [
        {
          pts: new Float32Array([0.1, 0.2, 0.5, 0.8, 0.9, 0.3]),
          travel: false,
          weight: 0.6,
        },
        { pts: new Float32Array([0.9, 0.3, 0.2, 0.7]), travel: true, weight: 0.4, closed: true },
      ],
      totalLength: 1.5,
    });
    const plotWire = serializePlot(plan, 0.42, items);

    const wire = serializeSession(
      sess,
      undoStack,
      [{ kind: 'removeStrokes', items }],
      ui,
      plotWire,
    );
    const parsed = JSON.parse(JSON.stringify(wire));
    const back = deserializeSession(parsed);

    expect(back.ui).toEqual(ui);
    expect(back.undoStack[0]).toEqual(undoStack[0]);
    // stroke items hydrate to the SAME objects living in the sticker lists
    const liveStroke = allStrokes(back.session.cube).find(
      (x) => x.stroke.id === items[0].stroke.id,
    );
    expect(back.undoStack[1].kind === 'addStrokes' && back.undoStack[1].items[0].stroke).toBe(
      liveStroke?.stroke,
    );

    const hydratedPlot = hydratePlot(back.plot!, back.session);
    expect(hydratedPlot.drawnLen).toBeCloseTo(0.42, 7);
    expect(hydratedPlot.items[0].stroke).toBe(liveStroke?.stroke);
    // plan polylines survive the Float32 → base64 → Float32 round trip
    expect(hydratedPlot.plan.polys[0].pts.length).toBe(6);
    expect(hydratedPlot.plan.polys[0].pts[0]).toBeCloseTo(plan.polys[0].pts[0], 6);
    expect(hydratedPlot.plan.polys[1].closed).toBe(true);
  });

  it('stroke id high-water mark restores (no id collisions after load)', () => {
    const sess = seededArtSession(11);
    const hiBefore = peekStrokeIdHi();
    expect(hiBefore).toBeGreaterThan(0);
    const wire = serializeSave(sess);
    const back = deserializeSave(JSON.parse(JSON.stringify(wire)));
    expect(peekStrokeIdHi()).toBe(hiBefore);
    // a fresh stroke after load draws a fresh id
    const subs = splitPolylineOnFace(back.cube, 'F', [0.1, 0.1, 0.2, 0.2], { weight: 1, travel: false });
    for (const sub of subs) {
      expect(sub.strokeId).toBeGreaterThan(hiBefore);
    }
  });

  it('a save→load→save cycle is stable', () => {
    const sess = seededArtSession(21);
    const once = serializeSave(sess);
    const back = deserializeSave(JSON.parse(JSON.stringify(once)));
    const twice = serializeSave(back);
    expect(JSON.stringify(twice.cubies)).toBe(JSON.stringify(once.cubies));
    expect(twice.strokes.length).toBe(once.strokes.length);
    expect(cubeStatesEqual(back.cube, back.cube)).toBe(true);
  });
});
