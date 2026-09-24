/**
 * History: a linear command timeline over a Session (cube + move log +
 * reference + tile images + paint version). Tile content is addressed by
 * sticker id and stored as dataURLs, so image commands compose across
 * scrambles — moves permute stickers, they never re-parent them.
 */

import type { CubeState } from './cubeState';
import { createSolvedCube } from './cubeState';
import { applyMoves } from './moves';
import type { MoveToken } from './moves';
import type { Vec3 } from './rotation';
import { orientationIndex } from './rotation';
import type { Face } from './faces';

/** per-sticker tile image (dataURL) — null = blank whiteboard tile */
export type TileImage = string | null;

export interface RefSnapshot {
  /** pose per cubie, indexed by cubie id (26 entries) */
  poses: Array<{ p: Vec3; o: number }>;
  /** move-log length at snapshot time */
  logLength: number;
  /** paint version at snapshot time — equality means art untouched since */
  paintVersion: number;
}

export interface TileItem {
  stickerId: number;
  before: TileImage;
  after: TileImage;
}

export type Command =
  | { kind: 'moves'; tokens: MoveToken[] }
  | { kind: 'setTiles'; items: TileItem[] }
  | { kind: 'setReference'; prev: RefSnapshot | null; next: RefSnapshot | null };

export interface Session {
  cube: CubeState;
  log: MoveToken[];
  reference: RefSnapshot | null;
  /** sticker id → tile dataURL (missing/null = blank) */
  tiles: Map<number, TileImage>;
  /** source face images by face (for repaint + export) */
  images: Record<Face, TileImage>;
  /** bumped on every paint — cheap "art modified" detector */
  paintVersion: number;
}

export const MAX_HISTORY = 200;

export function createSession(): Session {
  return {
    cube: createSolvedCube(),
    log: [],
    reference: null,
    tiles: new Map(),
    images: { U: null, D: null, L: null, R: null, F: null, B: null },
    paintVersion: 0,
  };
}

export function snapshotReference(sess: Session): RefSnapshot {
  const poses = new Array<{ p: Vec3; o: number }>(sess.cube.cubies.length);
  for (const c of sess.cube.cubies) {
    poses[c.id] = { p: [...c.pos] as Vec3, o: orientationIndex(c.R) };
  }
  return { poses, logLength: sess.log.length, paintVersion: sess.paintVersion };
}

/**
 * Is the cube exactly at `ref`? Poses + orientations exact AND no repaint has
 * happened since the snapshot (paintVersion equality).
 */
export function matchesReference(sess: Session, ref: RefSnapshot): boolean {
  if (sess.cube.cubies.length !== ref.poses.length) return false;
  for (const c of sess.cube.cubies) {
    const want = ref.poses[c.id];
    if (!want) return false;
    if (c.pos[0] !== want.p[0] || c.pos[1] !== want.p[1] || c.pos[2] !== want.p[2]) return false;
    if (orientationIndex(c.R) !== want.o) return false;
  }
  return sess.paintVersion === ref.paintVersion;
}

// --- command application (the redo path) ------------------------------------

/**
 * Apply a command's STATE effect. `logIt` mirrors the animated path: during
 * undo-replay, inverse moves are applied without appending to the log.
 */
export function applyCommandEffect(sess: Session, cmd: Command, logIt = true): number {
  switch (cmd.kind) {
    case 'moves': {
      sess.cube = applyMoves(sess.cube, cmd.tokens);
      if (logIt) sess.log.push(...cmd.tokens);
      return cmd.tokens.length;
    }
    case 'setTiles': {
      for (const it of cmd.items) {
        if (it.after === null) sess.tiles.delete(it.stickerId);
        else sess.tiles.set(it.stickerId, it.after);
      }
      sess.paintVersion++;
      return 0;
    }
    case 'setReference':
      sess.reference = cmd.next;
      return 0;
  }
}

/** Undo a command (instant state path). */
export function undoCommandEffect(sess: Session, cmd: Command): void {
  switch (cmd.kind) {
    case 'moves': {
      const n = cmd.tokens.length;
      const tail = sess.log.slice(sess.log.length - n);
      if (tail.length !== n || tail.some((t, i) => t !== cmd.tokens[i])) {
        throw new Error('log does not end with the moves being undone');
      }
      sess.log.length = sess.log.length - n;
      sess.cube = applyMoves(sess.cube, inverseOf(cmd.tokens));
      return;
    }
    case 'setTiles': {
      for (const it of cmd.items) {
        if (it.before === null) sess.tiles.delete(it.stickerId);
        else sess.tiles.set(it.stickerId, it.before);
      }
      sess.paintVersion--;
      return;
    }
    case 'setReference':
      sess.reference = cmd.prev;
      return;
  }
}

/** inverse move sequence (reverse order, inverted tokens) */
export function inverseOf(tokens: readonly MoveToken[]): MoveToken[] {
  return [...tokens].reverse().map((t) =>
    t.endsWith("'") ? (t.slice(0, 1) as MoveToken)
      : t.endsWith('2') ? t
      : (`${t}'` as MoveToken),
  );
}

/** pending moves since the reference snapshot (what solve() must replay) */
export function movesSinceReference(sess: Session): MoveToken[] {
  const from = sess.reference ? sess.reference.logLength : 0;
  return sess.log.slice(from);
}
