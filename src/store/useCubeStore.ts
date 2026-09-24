/**
 * useCubeStore — the single source of truth.
 *
 * Holds the core Session (cube, log, reference, tile images, paintVersion),
 * turn batches for the TurnAnimator, undo/redo stacks, and the light UI slice
 * (banner, onboarding gating). The 3D scene owns NO authoritative state: it
 * re-derives from here on every version bump.
 */

import { create } from 'zustand';
import { checkInvariants } from '../core/cubeState';
import type { MoveToken } from '../core/moves';
import { applyMoves } from '../core/moves';
import type { Face } from '../core/faces';
import { FACES } from '../core/faces';
import {
  matchesReference,
  snapshotReference,
  movesSinceReference,
  inverseOf,
  applyCommandEffect,
  undoCommandEffect,
  MAX_HISTORY,
  createSession,
} from '../core/history';
import type { Command, Session, TileItem } from '../core/history';
import { generateScramble } from '../core/scramble';
import { emit } from '../utils/bus';
import { decodeDataUrl, toSquareCanvas, toSquareDataUrl } from '../imaging/compose';
import { paintFaceTiles } from '../imaging/faceBlit';

export type Busy = 'idle' | 'turning';

export interface TurnBatch {
  tokens: MoveToken[];
  /** append committed tokens to the move log */
  log: boolean;
  /** push a single 'moves' command onto the undo stack when the batch drains */
  undoable: boolean;
  /** truncate this many tokens from the log tail when the batch drains */
  truncateLog: number;
  /** fast animation (scramble/solve batches) */
  fast: boolean;
  label: string;
}

interface CubeStore {
  session: Session;
  version: number;
  busy: Busy;
  turnBatches: TurnBatch[];
  animating: boolean;
  undoStack: Command[];
  redoStack: Command[];
  /** repaint picker target (null = closed); onboarding shows while !started */
  repaintFace: Face | null;
  banner: { text: string; at: number } | null;
  sessionRestored: boolean;

  // --- turn machinery ---
  enqueueTurns: (tokens: MoveToken[], opts?: Partial<Omit<TurnBatch, 'tokens'>>) => boolean;
  commitMove: (token: MoveToken, logIt: boolean) => void;
  finishBatch: () => void;
  markAnimating: (v: boolean) => void;

  // --- history ---
  pushCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;

  // --- painting ---
  setFaceImage: (face: Face, sourceDataUrl: string) => Promise<void>;
  startPuzzle: (images: Partial<Record<Face, string>>) => Promise<void>;
  setRepaintFace: (face: Face | null) => void;

  // --- ui ---
  clearBanner: () => void;
  scrambleNow: (seed?: number) => void;
  solveNow: () => void;

  // --- session bridge ---
  hydrate: (data: {
    session: Session;
    undoStack: Command[];
    redoStack: Command[];
  }) => void;
  newSession: () => void;
}

export function hasAllImages(sess: Session): boolean {
  return FACES.every((f) => typeof sess.images[f] === 'string');
}

export const useCubeStore = create<CubeStore>((set, get) => ({
  session: createSession(),
  version: 0,
  busy: 'idle',
  turnBatches: [],
  animating: false,
  undoStack: [],
  redoStack: [],
  repaintFace: null,
  banner: null,
  sessionRestored: false,

  // --- turns ---

  enqueueTurns: (tokens, opts = {}) => {
    if (tokens.length === 0) return true;
    const batch: TurnBatch = {
      tokens,
      log: opts.log ?? true,
      undoable: opts.undoable ?? true,
      truncateLog: opts.truncateLog ?? 0,
      fast: opts.fast ?? false,
      label: opts.label ?? 'turn',
    };
    set((s) => ({ turnBatches: [...s.turnBatches, batch], busy: 'turning' }));
    return true;
  },

  commitMove: (token, logIt) => {
    set((s) => {
      const session = s.session;
      session.cube = applyMoves(session.cube, [token]);
      if (logIt) session.log.push(token);
      checkInvariants(session.cube);
      return { session, version: s.version + 1 };
    });
  },

  finishBatch: () => {
    const state = get();
    const remaining = state.turnBatches.slice(1);
    const done = state.turnBatches[0];
    const session = state.session;
    if (done.truncateLog > 0) {
      session.log.length = Math.max(0, session.log.length - done.truncateLog);
    }
    if (done.undoable && done.tokens.length > 0) {
      get().pushCommand({ kind: 'moves', tokens: done.tokens });
    }
    let banner = state.banner;
    if (session.reference && matchesReference(session, session.reference) && done.label === 'solve') {
      banner = { text: 'Solved — picture restored', at: Date.now() };
      emit('celebrate', {});
    }
    set({ turnBatches: remaining, busy: remaining.length > 0 ? 'turning' : 'idle', banner });
  },

  markAnimating: (v) => set({ animating: v }),

  // --- history ---

  pushCommand: (cmd) => {
    set((s) => ({
      undoStack: [...s.undoStack, cmd].slice(-MAX_HISTORY),
      redoStack: [],
    }));
  },

  undo: () => {
    const s = get();
    const cmd = s.undoStack[s.undoStack.length - 1];
    if (!cmd) return;
    if (cmd.kind === 'moves') {
      get().enqueueTurns(inverseOf(cmd.tokens), {
        log: false,
        undoable: false,
        truncateLog: cmd.tokens.length,
        fast: cmd.tokens.length > 8,
        label: 'undo',
      });
      set((st) => ({
        undoStack: st.undoStack.slice(0, -1),
        redoStack: [...st.redoStack, cmd],
      }));
      return;
    }
    const session = s.session;
    undoCommandEffect(session, cmd);
    set({
      session,
      version: s.version + 1,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
    });
  },

  redo: () => {
    const s = get();
    const cmd = s.redoStack[s.redoStack.length - 1];
    if (!cmd) return;
    if (cmd.kind === 'moves') {
      get().enqueueTurns(cmd.tokens, {
        log: true,
        undoable: false,
        fast: cmd.tokens.length > 8,
        label: 'redo',
      });
      set((st) => ({
        redoStack: st.redoStack.slice(0, -1),
        undoStack: [...st.undoStack, cmd],
      }));
      return;
    }
    const session = s.session;
    applyCommandEffect(session, cmd);
    set({
      session,
      version: s.version + 1,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, cmd],
    });
  },

  // --- painting ---

  setFaceImage: async (face, sourceDataUrl) => {
    const s = get();
    const img = await decodeDataUrl(sourceDataUrl);
    const square = toSquareCanvas(img, 'contain');
    const squareUrl = toSquareDataUrl(img, 'contain');
    const items: TileItem[] = paintFaceTiles(s.session.cube, face, square).map((p) => ({
      stickerId: p.stickerId,
      before: s.session.tiles.get(p.stickerId) ?? null,
      after: p.dataUrl,
    }));
    const session = s.session;
    session.images[face] = squareUrl;
    applyCommandEffect(session, { kind: 'setTiles', items });
    set({ session, version: get().version + 1 });
    get().pushCommand({ kind: 'setTiles', items });
  },

  startPuzzle: async (images) => {
    for (const face of FACES) {
      const src = images[face];
      if (!src) continue;
      // eslint-disable-next-line no-await-in-loop
      await get().setFaceImage(face, src);
    }
    const s = get();
    if (!hasAllImages(s.session)) {
      set({ banner: { text: 'Every face needs an image first', at: Date.now() } });
      return;
    }
    const prev = s.session.reference;
    const next = snapshotReference(s.session);
    s.session.reference = next;
    set({ session: s.session, version: s.version + 1 });
    get().pushCommand({ kind: 'setReference', prev, next });
    set({ banner: { text: 'Ready — drag a row or column to twist', at: Date.now() } });
  },

  setRepaintFace: (face) => set({ repaintFace: face }),

  // --- ui ---

  clearBanner: () => set({ banner: null }),

  scrambleNow: (seed = Date.now() % 2147483647) => {
    const tokens = generateScramble(seed);
    get().enqueueTurns(tokens, { fast: true, label: 'scramble' });
    set({ banner: { text: 'Scrambled — solve to restore the picture', at: Date.now() } });
  },

  solveNow: () => {
    const s = get();
    if (!s.session.reference) {
      set({ banner: { text: 'Nothing to solve back to yet', at: Date.now() } });
      return;
    }
    const pending = movesSinceReference(s.session);
    if (pending.length === 0 && matchesReference(s.session, s.session.reference)) {
      set({ banner: { text: 'Already solved', at: Date.now() } });
      return;
    }
    get().enqueueTurns(inverseOf(pending), {
      fast: true,
      undoable: false,
      truncateLog: pending.length,
      label: 'solve',
    });
  },

  // --- session bridge ---

  hydrate: ({ session, undoStack, redoStack }) => {
    checkInvariants(session.cube);
    set({
      session,
      undoStack,
      redoStack,
      version: get().version + 1,
      sessionRestored: true,
    });
  },

  newSession: () => {
    set({
      session: createSession(),
      undoStack: [],
      redoStack: [],
      turnBatches: [],
      busy: 'idle',
      version: get().version + 1,
      repaintFace: null,
      banner: null,
    });
  },
}));
