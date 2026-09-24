/**
 * History: a linear command timeline over a Session (cube + move log +
 * reference). Strokes are immutable and id-addressed, so stroke commands
 * compose across scrambles — moves permute stickers but never re-parent or
 * mutate strokes, which is what makes "undo a stroke I drew before the
 * scramble" well-defined.
 *
 * The store drives animated move application; these pure functions define
 * the SEMANTICS (unit-tested in tests/history.test.ts, gate P7).
 */

import type { CubeState } from './cubeState';
import { applyMoves } from './moves';
import type { MoveToken } from './moves';
import type { Stroke } from './stickers';
import type { Vec3 } from './rotation';
import { orientationIndex } from './rotation';

export interface RefSnapshot {
  /** pose per cubie, indexed by cubie id (26 entries) */
  poses: Array<{ p: Vec3; o: number }>;
  /** sorted ids of every stroke alive at snapshot time */
  strokeIds: number[];
  /** move-log length at snapshot time */
  logLength: number;
}

export interface StrokeItem {
  stickerId: number;
  stroke: Stroke;
}

export type Command =
  | { kind: 'moves'; tokens: MoveToken[] }
  | { kind: 'addStrokes'; items: StrokeItem[] }
  | { kind: 'removeStrokes'; items: StrokeItem[] }
  | { kind: 'setReference'; prev: RefSnapshot | null; next: RefSnapshot | null };

export interface Session {
  cube: CubeState;
  log: MoveToken[];
  reference: RefSnapshot | null;
}

export const MAX_HISTORY = 200;

export function snapshotReference(cube: CubeState, logLength: number): RefSnapshot {
  const poses = new Array<{ p: Vec3; o: number }>(cube.cubies.length);
  const strokeIds: number[] = [];
  for (const c of cube.cubies) {
    poses[c.id] = { p: [...c.pos] as Vec3, o: orientationIndex(c.R) };
    for (const s of c.stickers) {
      for (const st of s.strokes) strokeIds.push(st.id);
    }
  }
  strokeIds.sort((a, b) => a - b);
  return { poses, strokeIds, logLength };
}

/** is the cube exactly at `ref` (poses + orientations + live stroke set)? */
export function matchesReference(cube: CubeState, ref: RefSnapshot): boolean {
  if (cube.cubies.length !== ref.poses.length) return false;
  for (const c of cube.cubies) {
    const want = ref.poses[c.id];
    if (!want) return false;
    if (c.pos[0] !== want.p[0] || c.pos[1] !== want.p[1] || c.pos[2] !== want.p[2]) return false;
    if (orientationIndex(c.R) !== want.o) return false;
  }
  const live = new Set<number>();
  for (const c of cube.cubies) {
    for (const s of c.stickers) for (const st of s.strokes) live.add(st.id);
  }
  if (live.size !== ref.strokeIds.length) return false;
  for (const id of ref.strokeIds) {
    if (!live.has(id)) return false;
  }
  return true;
}

// --- stroke list surgery (mutates sticker.strokes arrays in place) ---------

function findSticker(state: CubeState, stickerId: number) {
  for (const c of state.cubies) {
    for (const s of c.stickers) if (s.id === stickerId) return s;
  }
  throw new Error(`sticker ${stickerId} not found`);
}

function removeStrokeItems(cube: CubeState, items: StrokeItem[]): void {
  for (const { stickerId, stroke } of items) {
    const sticker = findSticker(cube, stickerId);
    const idx = sticker.strokes.indexOf(stroke);
    if (idx === -1) throw new Error(`stroke ${stroke.id} not on sticker ${stickerId}`);
    sticker.strokes.splice(idx, 1);
  }
}

function addStrokeItems(cube: CubeState, items: StrokeItem[]): void {
  for (const { stickerId, stroke } of items) {
    findSticker(cube, stickerId).strokes.push(stroke);
  }
}

// --- command application (the redo path; also used by animated replay) ----

/**
 * Apply a command's STATE effect. `logIt` mirrors the animated path: during
 * undo-replay, inverse moves are applied without appending to the log.
 * Returns the number of tokens appended to the log (for truncation on undo).
 */
export function applyCommandEffect(
  sess: Session,
  cmd: Command,
  logIt = true,
): number {
  switch (cmd.kind) {
    case 'moves': {
      sess.cube = applyMoves(sess.cube, cmd.tokens);
      if (logIt) sess.log.push(...cmd.tokens);
      return cmd.tokens.length;
    }
    case 'addStrokes':
      addStrokeItems(sess.cube, cmd.items);
      return 0;
    case 'removeStrokes':
      removeStrokeItems(sess.cube, cmd.items);
      return 0;
    case 'setReference':
      sess.reference = cmd.next;
      return 0;
  }
}

/**
 * Undo a command (instant state path). For 'moves', verifies the log ends
 * with the command's tokens, truncates, and applies the inverse sequence.
 */
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
    case 'addStrokes':
      removeStrokeItems(sess.cube, cmd.items);
      return;
    case 'removeStrokes':
      addStrokeItems(sess.cube, cmd.items);
      return;
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
