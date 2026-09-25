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
  posesMatchReference,
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
  /** transient toast message (auto-clears) */
  banner: { text: string; at: number } | null;
  sessionRestored: boolean;
  /** celebration fires only on not-solved → solved transitions */
  wasSolved: boolean;
  /** solve timer: epoch ms of the last scramble (null = not racing) */
  timerStartedAt: number | null;
  /** final time of the last completed solve */
  lastSolveMs: number | null;
  /** best solve time ever (persisted separately in localStorage) */
  bestSolveMs: number | null;
  /** timer is opt-in — off by default */
  timerOn: boolean;

  // --- turn machinery ---
  enqueueTurns: (tokens: MoveToken[], opts?: Partial<Omit<TurnBatch, 'tokens'>>) => boolean;
  commitMove: (token: MoveToken, logIt: boolean) => void;
  finishBatch: () => void;
  markAnimating: (v: boolean) => void;

  // --- history ---
  pushCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  checkSolved: () => void;

  // --- painting ---
  setFaceImage: (face: Face, sourceDataUrl: string) => Promise<void>;
  startPuzzle: (images: Partial<Record<Face, string>>) => Promise<void>;

  // --- ui ---
  clearBanner: () => void;
  scrambleNow: (seed?: number) => void;
  solveNow: () => void;
  setTimerOn: (on: boolean) => void;

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

const BEST_KEY = 'rupiks.best-ms';
const TIMER_KEY = 'rupiks.timer-on';

function readTimerOn(): boolean {
  try {
    return localStorage.getItem(TIMER_KEY) === '1';
  } catch {
    return false;
  }
}

function readBestSolve(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const useCubeStore = create<CubeStore>((set, get) => ({
  session: createSession(),
  version: 0,
  busy: 'idle',
  turnBatches: [],
  animating: false,
  undoStack: [],
  redoStack: [],
  banner: null,
  sessionRestored: false,
  wasSolved: false,
  timerStartedAt: null,
  lastSolveMs: null,
  bestSolveMs: readBestSolve(),
  timerOn: readTimerOn(),

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
    set({ turnBatches: remaining, busy: remaining.length > 0 ? 'turning' : 'idle' });
    get().checkSolved();
  },

  /**
   * Fire the celebration on not-solved → solved transitions, however the
   * cube got there: the solve button, manual twisting, or undo. A fresh
   * reference snapshot seeds the state silently.
   */
  checkSolved: () => {
    const s = get();
    const sess = s.session;
    if (!sess.reference) {
      if (s.wasSolved) set({ wasSolved: false });
      return;
    }
    const now = matchesReference(sess, sess.reference);
    if (now && !s.wasSolved) {
      // stop the clock on a genuine solve arrival (only when the timer is on)
      let elapsed: number | null = null;
      let best = s.bestSolveMs;
      if (s.timerStartedAt !== null && s.timerOn) {
        elapsed = Date.now() - s.timerStartedAt;
        if (best === null || elapsed < best) {
          best = elapsed;
          try {
            localStorage.setItem(BEST_KEY, String(Math.round(elapsed)));
          } catch {
            /* best-time persistence is best-effort */
          }
        }
      }
      set({
        wasSolved: true,
        timerStartedAt: null,
        lastSolveMs: elapsed ?? s.lastSolveMs,
        bestSolveMs: best,
        banner: {
          text:
            elapsed !== null
              ? `Solved in ${formatMs(elapsed)}${best === elapsed ? ' — new best!' : ''}`
              : 'Solved — picture restored',
          at: Date.now(),
        },
      });
      emit('celebrate', {});
    } else if (!now && s.wasSolved) {
      set({ wasSolved: false });
    }
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
    get().checkSolved();
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
    get().checkSolved();
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
    // A swap at the reference POSES re-defines the puzzle: the new art becomes
    // the goal (a swap mid-scramble is blocked by the UI — it would be
    // unsolvable). Re-snapshot silently so no confetti fires for an edit.
    if (session.reference && posesMatchReference(session, session.reference)) {
      const prev = session.reference;
      const next = snapshotReference(session);
      session.reference = next;
      set({ session, wasSolved: true });
      get().pushCommand({ kind: 'setReference', prev, next });
    } else {
      get().checkSolved(); // a repaint un-solves; update the transition tracker
    }
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
    // the fresh snapshot IS solved — seed the tracker silently (no confetti)
    set({ wasSolved: true });
    set({ banner: { text: 'Ready — drag a row or column to twist', at: Date.now() } });
  },


  // --- ui ---

  clearBanner: () => set({ banner: null }),

  scrambleNow: (seed = Date.now() % 2147483647) => {
    const tokens = generateScramble(seed);
    get().enqueueTurns(tokens, { fast: true, label: 'scramble' });
    set({
      timerStartedAt: useCubeStore.getState().timerOn ? Date.now() : null,
      lastSolveMs: null,
      banner: { text: 'Scrambled — solve to restore the picture', at: Date.now() },
    });
  },

  setTimerOn: (on) => {
    try {
      localStorage.setItem(TIMER_KEY, on ? '1' : '0');
    } catch {
      /* preference persistence is best-effort */
    }
    set({
      timerOn: on,
      // switching off mid-race abandons the clock
      timerStartedAt: on ? useCubeStore.getState().timerStartedAt : null,
      lastSolveMs: on ? useCubeStore.getState().lastSolveMs : null,
    });
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
      banner: null,
      wasSolved: false,
      sessionRestored: false,
      timerStartedAt: null,
      lastSolveMs: null,
    });
  },
}));
