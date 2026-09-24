/**
 * Serialization v2 — photo-cube formats.
 *
 *  SAVE FILE v2 (`twistdraw-cube/save`): shareable puzzle snapshot — cube
 *  poses, tile dataURLs (the actual pixels), the 6 source face images, move
 *  log, reference, paint version.
 *
 *  SESSION v2 (`twistdraw-cube/session`): full continuation — the save plus
 *  undo/redo stacks. Restore blits dataURLs straight onto tile canvases; no
 *  geometry re-derivation.
 */

import type { CubeState } from './cubeState';
import { createSolvedCube, checkInvariants, posKey } from './cubeState';
import type { Cubie } from './cubeState';
import { orientationFromIndex, orientationIndex } from './rotation';
import type { Vec3 } from './rotation';
import type { MoveToken } from './moves';
import type { Command, RefSnapshot, Session, TileImage } from './history';
import type { Face } from './faces';

// --- wire types -------------------------------------------------------------

interface SaveWire {
  format: 'twistdraw-cube/save';
  version: 2;
  cubies: Array<{ id: number; p: [number, number, number]; o: number }>;
  /** sticker id → tile dataURL (nulls are simply absent) */
  tiles: Array<[number, TileImage]>;
  /** source face images by face */
  images: Partial<Record<Face, string | null>>;
  log: MoveToken[];
  reference: RefSnapshot | null;
  paintVersion: number;
}

interface CommandWire {
  kind: 'moves' | 'setTiles' | 'setReference';
  tokens?: MoveToken[];
  items?: Array<{ stickerId: number; before: TileImage; after: TileImage }>;
  prev?: RefSnapshot | null;
  next?: RefSnapshot | null;
}

interface SessionWire {
  format: 'twistdraw-cube/session';
  version: 2;
  save: SaveWire;
  undo: CommandWire[];
  redo: CommandWire[];
}

// --- save file ---------------------------------------------------------------

export function serializeSave(sess: Session): SaveWire {
  return {
    format: 'twistdraw-cube/save',
    version: 2,
    cubies: sess.cube.cubies.map((c) => ({
      id: c.id,
      p: [c.pos[0], c.pos[1], c.pos[2]],
      o: orientationIndex(c.R),
    })),
    tiles: [...sess.tiles.entries()].map(([id, url]) => [id, url]),
    images: { ...sess.images },
    log: [...sess.log],
    reference: sess.reference,
    paintVersion: sess.paintVersion,
  };
}

export function deserializeSave(wire: SaveWire): Session {
  if (wire?.format !== 'twistdraw-cube/save' || wire.version !== 2) {
    throw new Error('unrecognized save file (expected twistdraw-cube/save v2)');
  }
  const base = createSolvedCube();
  const cubies: Cubie[] = wire.cubies.map((cw) => {
    const template = base.cubies[cw.id];
    if (!template) throw new Error(`unknown cubie id ${cw.id}`);
    return {
      ...template,
      pos: [cw.p[0], cw.p[1], cw.p[2]] as Vec3,
      R: orientationFromIndex(cw.o),
    };
  });
  const cube: CubeState = {
    cubies,
    posIndex: new Map(cubies.map((c) => [posKey(c.pos), c])),
  };
  checkInvariants(cube);
  return {
    cube,
    log: [...wire.log],
    reference: wire.reference ?? null,
    tiles: new Map(wire.tiles.filter(([, url]) => typeof url === 'string')),
    images: { U: null, D: null, L: null, R: null, F: null, B: null, ...wire.images },
    paintVersion: wire.paintVersion ?? 0,
  };
}

// --- session -----------------------------------------------------------------

export function serializeSession(
  sess: Session,
  undo: Command[],
  redo: Command[],
): SessionWire {
  const cmdWire = (cmd: Command): CommandWire => {
    switch (cmd.kind) {
      case 'moves':
        return { kind: 'moves', tokens: cmd.tokens };
      case 'setTiles':
        return { kind: 'setTiles', items: cmd.items };
      case 'setReference':
        return { kind: 'setReference', prev: cmd.prev, next: cmd.next };
    }
  };
  return {
    format: 'twistdraw-cube/session',
    version: 2,
    save: serializeSave(sess),
    undo: undo.map(cmdWire),
    redo: redo.map(cmdWire),
  };
}

export function deserializeSession(wire: SessionWire): {
  session: Session;
  undoStack: Command[];
  redoStack: Command[];
} {
  if (wire?.format !== 'twistdraw-cube/session' || wire.version !== 2) {
    throw new Error('unrecognized session file (expected twistdraw-cube/session v2)');
  }
  const session = deserializeSave(wire.save);
  const hydrate = (cw: CommandWire): Command => {
    switch (cw.kind) {
      case 'moves':
        if (!cw.tokens) throw new Error('moves command missing tokens');
        return { kind: 'moves', tokens: cw.tokens };
      case 'setTiles':
        return { kind: 'setTiles', items: cw.items ?? [] };
      case 'setReference':
        return { kind: 'setReference', prev: cw.prev ?? null, next: cw.next ?? null };
    }
  };
  return {
    session,
    undoStack: wire.undo.map(hydrate),
    redoStack: wire.redo.map(hydrate),
  };
}
