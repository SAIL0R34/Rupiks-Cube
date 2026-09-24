/**
 * Serialization — two related JSON formats:
 *
 *  SAVE FILE v1 (`twistdraw-cube/save`) — the shareable artwork snapshot:
 *  cube poses, strokes, move log, reference. Small and portable.
 *
 *  SESSION v1 (`twistdraw-cube/session`) — full continuation: the save file
 *  plus undo/redo stacks, UI slice, and an optional in-flight plot (serialized
 *  EtchPlan + drawn length + uncommitted plot strokes). This is what the
 *  localStorage memory store persists so the user can pause and return.
 *
 * Stroke points quantize to u8 pairs (~2.7 bytes/point after base64).
 * Deserialized strokes are interned by id so history commands and live
 * sticker lists share the SAME stroke objects (identity-based undo relies
 * on this).
 */

import type { CubeState } from './cubeState';
import { createSolvedCube, checkInvariants, posKey } from './cubeState';
import type { Cubie } from './cubeState';
import { orientationFromIndex, orientationIndex } from './rotation';
import type { Vec3 } from './rotation';
import type { Stroke } from './stickers';
import { setStrokeIdHi, peekStrokeIdHi } from './stickers';
import type { MoveToken } from './moves';
import type { Command, RefSnapshot, Session, StrokeItem } from './history';
import { bytesToBase64, base64ToBytes } from '../utils/base64';

// --- wire types -------------------------------------------------------------

interface StrokeWire {
  id: number;
  stickerId: number;
  weight: number;
  travel: boolean;
  closed?: boolean;
  /** quantized interleaved s,t pairs (u8 each) */
  q: string;
}

interface SaveWire {
  format: 'twistdraw-cube/save';
  version: 1;
  cubies: Array<{ id: number; p: [number, number, number]; o: number }>;
  strokes: StrokeWire[];
  log: MoveToken[];
  reference: RefSnapshot | null;
  strokeIdHi: number;
}

interface CommandWire {
  kind: 'moves' | 'addStrokes' | 'removeStrokes' | 'setReference';
  tokens?: MoveToken[];
  items?: Array<{ stickerId: number; strokeId: number }>;
  prev?: RefSnapshotWire | null;
  next?: RefSnapshotWire | null;
}

type RefSnapshotWire = RefSnapshot;

export interface SessionUIWire {
  activeFace: string;
  turnFace: string;
  mode: string;
  penDown: boolean;
  speed: number;
  complexity: string;
  cursor: { u: number; v: number; visible: boolean };
}

export interface PlotWire {
  plan: {
    polys: Array<{ q: string; travel: boolean; weight: number; closed?: boolean }>;
    totalLength: number;
  };
  drawnLen: number;
  items: Array<{ stickerId: number; strokeId: number }>;
}

interface SessionWire {
  format: 'twistdraw-cube/session';
  version: 1;
  save: SaveWire;
  undo: CommandWire[];
  redo: CommandWire[];
  ui: SessionUIWire;
  plot: PlotWire | null;
}

// --- quantization -----------------------------------------------------------

function quantizePts(pts: number[]): string {
  const bytes = new Uint8Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const c = Math.min(1, Math.max(0, pts[i]));
    bytes[i] = Math.round(c * 255);
  }
  return bytesToBase64(bytes);
}

function dequantizePts(q: string): number[] {
  const bytes = base64ToBytes(q);
  const pts: number[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) pts[i] = bytes[i] / 255;
  return pts;
}

// --- save file (artwork snapshot) -------------------------------------------

export function serializeSave(sess: Session): SaveWire {
  const strokes: StrokeWire[] = [];
  for (const c of sess.cube.cubies) {
    for (const s of c.stickers) {
      for (const st of s.strokes) {
        strokes.push({
          id: st.id,
          stickerId: s.id,
          weight: st.weight,
          travel: st.travel,
          ...(st.closed ? { closed: true } : {}),
          q: quantizePts(st.pts),
        });
      }
    }
  }
  return {
    format: 'twistdraw-cube/save',
    version: 1,
    cubies: sess.cube.cubies.map((c) => ({
      id: c.id,
      p: [c.pos[0], c.pos[1], c.pos[2]],
      o: orientationIndex(c.R),
    })),
    strokes,
    log: [...sess.log],
    reference: sess.reference,
    strokeIdHi: peekStrokeIdHi(),
  };
}

export function deserializeSave(wire: SaveWire): Session {
  if (wire?.format !== 'twistdraw-cube/save' || wire.version !== 1) {
    throw new Error('unrecognized save file');
  }
  const base = createSolvedCube();
  const byId = new Map<number, Stroke>();
  const strokesBySticker = new Map<number, Stroke[]>();
  for (const sw of wire.strokes) {
    const stroke: Stroke = {
      id: sw.id,
      pts: dequantizePts(sw.q),
      weight: sw.weight,
      travel: sw.travel,
      ...(sw.closed ? { closed: true } : {}),
    };
    byId.set(sw.id, stroke);
    const list = strokesBySticker.get(sw.stickerId) ?? [];
    list.push(stroke);
    strokesBySticker.set(sw.stickerId, list);
  }
  const cubies: Cubie[] = wire.cubies.map((cw) => {
    const template = base.cubies[cw.id];
    if (!template) throw new Error(`unknown cubie id ${cw.id}`);
    return {
      ...template,
      pos: [cw.p[0], cw.p[1], cw.p[2]] as Vec3,
      R: orientationFromIndex(cw.o),
      stickers: template.stickers.map((s) => ({
        ...s,
        strokes: (strokesBySticker.get(s.id) ?? []).slice(),
      })),
    };
  });
  const cube: CubeState = {
    cubies,
    posIndex: new Map(cubies.map((c) => [posKey(c.pos), c])),
  };
  checkInvariants(cube);
  setStrokeIdHi(wire.strokeIdHi ?? 0);
  return { cube, log: [...wire.log], reference: wire.reference ?? null };
}

// --- session (continuation) --------------------------------------------------

export function serializeSession(
  sess: Session,
  undo: Command[],
  redo: Command[],
  ui: SessionUIWire,
  plot: PlotWire | null,
): SessionWire {
  const save = serializeSave(sess);
  const cmdWire = (cmd: Command): CommandWire => {
    switch (cmd.kind) {
      case 'moves':
        return { kind: 'moves', tokens: cmd.tokens };
      case 'addStrokes':
      case 'removeStrokes':
        return {
          kind: cmd.kind,
          items: cmd.items.map((i) => ({ stickerId: i.stickerId, strokeId: i.stroke.id })),
        };
      case 'setReference':
        return { kind: 'setReference', prev: cmd.prev, next: cmd.next };
    }
  };
  return {
    format: 'twistdraw-cube/session',
    version: 1,
    save,
    undo: undo.map(cmdWire),
    redo: redo.map(cmdWire),
    ui,
    plot,
  };
}

export function deserializeSession(wire: SessionWire): {
  session: Session;
  undoStack: Command[];
  redoStack: Command[];
  ui: SessionUIWire;
  plot: PlotWire | null;
} {
  if (wire?.format !== 'twistdraw-cube/session' || wire.version !== 1) {
    throw new Error('unrecognized session file');
  }
  const session = deserializeSave(wire.save);
  // intern strokes by id so commands reference the SAME objects as the lists
  const strokeById = new Map<number, Stroke>();
  for (const c of session.cube.cubies) {
    for (const s of c.stickers) {
      for (const st of s.strokes) strokeById.set(st.id, st);
    }
  }
  // plot items may reference strokes not yet in any list (uncommitted) —
  // deserialize them separately below
  const hydrate = (cw: CommandWire): Command => {
    switch (cw.kind) {
      case 'moves':
        if (!cw.tokens) throw new Error('moves command missing tokens');
        return { kind: 'moves', tokens: cw.tokens };
      case 'addStrokes':
      case 'removeStrokes': {
        const items: StrokeItem[] = (cw.items ?? []).map((iw) => {
          const stroke = strokeById.get(iw.strokeId);
          if (!stroke) throw new Error(`stroke ${iw.strokeId} not found for ${cw.kind}`);
          return { stickerId: iw.stickerId, stroke };
        });
        return { kind: cw.kind, items };
      }
      case 'setReference':
        return { kind: 'setReference', prev: cw.prev ?? null, next: cw.next ?? null };
    }
  };
  return {
    session,
    undoStack: wire.undo.map(hydrate),
    redoStack: wire.redo.map(hydrate),
    ui: wire.ui,
    plot: wire.plot ?? null,
  };
}

/** rebuild a mid-flight plot's mapped plan + items (for resume) */
export function hydratePlot(
  plot: PlotWire,
  session: Session,
): { plan: import('../plotting/planMapper').MappedPlan; drawnLen: number; items: StrokeItem[] } {
  const strokeById = new Map<number, Stroke>();
  for (const c of session.cube.cubies) {
    for (const s of c.stickers) {
      for (const st of s.strokes) strokeById.set(st.id, st);
    }
  }
  const polys = plot.plan.polys.map((pw) => {
    const bytes = base64ToBytes(pw.q);
    const f32 = new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
    return {
      pts: Array.from(f32),
      travel: pw.travel,
      weight: pw.weight,
      ...(pw.closed ? { closed: true } : {}),
    };
  });
  const items: StrokeItem[] = plot.items.map((iw) => {
    const stroke = strokeById.get(iw.strokeId);
    if (!stroke) throw new Error(`plot stroke ${iw.strokeId} missing`);
    return { stickerId: iw.stickerId, stroke };
  });
  return { plan: { polys, totalLength: plot.plan.totalLength }, drawnLen: plot.drawnLen, items };
}

/** serialize the in-flight plot (inverse of hydratePlot) */
export function serializePlot(
  plan: import('../plotting/planMapper').MappedPlan,
  drawnLen: number,
  items: StrokeItem[],
): PlotWire {
  return {
    plan: {
      polys: plan.polys.map((p) => {
        const f32 = new Float32Array(p.pts);
        return {
          q: bytesToBase64(new Uint8Array(f32.buffer, 0, f32.byteLength)),
          travel: p.travel,
          weight: p.weight,
          ...(p.closed ? { closed: true } : {}),
        };
      }),
      totalLength: plan.totalLength,
    },
    drawnLen,
    items: items.map((i) => ({ stickerId: i.stickerId, strokeId: i.stroke.id })),
  };
}
