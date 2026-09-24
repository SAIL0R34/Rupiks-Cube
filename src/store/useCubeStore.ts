/**
 * useCubeStore — the single source of truth.
 *
 * Holds the core Session (cube, log, reference), turn batches for the
 * TurnAnimator, undo/redo stacks, plotting status and the UI slice. The 3D
 * scene owns NO authoritative state: it re-derives from here on every version
 * bump. Mutation entry points are deliberately narrow — enqueueTurns /
 * commitMove for moves, explicit stroke commands for art — guarded by the
 * `busy` ownership token.
 */

import { create } from 'zustand';
import { createSolvedCube, checkInvariants } from '../core/cubeState';
import type { MoveToken } from '../core/moves';
import { applyMoves } from '../core/moves';
import type { Face } from '../core/faces';
import { FACES, FACE_FRAME } from '../core/faces';
import { applyVec } from '../core/rotation';
import {
  matchesReference,
  snapshotReference,
  movesSinceReference,
  inverseOf,
  MAX_HISTORY,
} from '../core/history';
import type { Command, Session, StrokeItem } from '../core/history';
import { tileToFace } from '../core/transform';
import { generateScramble } from '../core/scramble';
import { splitPolylineOnFace } from '../core/strokeSplitter';
import { clamp } from '../utils/geometry2d';

export type Busy = 'idle' | 'turning' | 'plotting';
export type Mode = 'idle' | 'pen' | 'erase';

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

export interface PlottingStatus {
  status: 'idle' | 'processing' | 'plotting';
  stage: string;
  progress: number;
}

interface CubeStore {
  session: Session;
  version: number;
  busy: Busy;
  turnBatches: TurnBatch[];
  animating: boolean; // TurnAnimator's private flag, set via markAnimating
  undoStack: Command[];
  redoStack: Command[];

  // UI slice
  activeFace: Face; // drawing face
  turnFace: Face; // K1 selection
  mode: Mode;
  penDown: boolean;
  cursor: { u: number; v: number; visible: boolean };
  speed: number; // 1..8
  plotting: PlottingStatus;
  banner: { text: string; at: number } | null;
  knobFlash: { which: 'turn'; at: number } | null;
  sessionRestored: boolean;
  pendingPlotResume: unknown; // serialized in-flight plot (session store)
  manualItems: StrokeItem[]; // experienced-mode pen accumulation

  // --- turn machinery ---
  enqueueTurns: (
    tokens: MoveToken[],
    opts?: Partial<Omit<TurnBatch, 'tokens'>>,
  ) => boolean;
  commitMove: (token: MoveToken, logIt: boolean) => void;
  finishBatch: () => void;
  markAnimating: (v: boolean) => void;

  // --- history ---
  pushCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;

  // --- strokes ---
  appendPlotStrokes: (items: StrokeItem[]) => void;
  commitPlotBatch: (items: StrokeItem[]) => void;
  setReferenceNow: () => void;
  clearActiveFace: () => void;
  clearAllStrokes: () => void;
  eraseNear: (face: Face, u: number, v: number, radius: number) => void;

  // --- experienced mode ---
  togglePen: () => void;
  nudgeCursor: (du: number, dv: number) => void;
  setCursor: (u: number, v: number) => void;
  commitManualStroke: () => void;

  // --- ui ---
  setUI: (partial: Partial<{
    activeFace: Face;
    turnFace: Face;
    mode: Mode;
    penDown: boolean;
    speed: number;
    cursor: { u: number; v: number; visible: boolean };
    banner: { text: string; at: number } | null;
    plotting: PlottingStatus;
    sessionRestored: boolean;
    pendingPlotResume: unknown;
  }>) => void;
  cycleActiveFace: (dir?: 1 | -1) => void;
  cycleTurnFace: (dir?: 1 | -1) => void;
  flashTurnKnob: () => void;
  clearBanner: () => void;

  // --- macro ---
  scrambleNow: (seed?: number) => void;
  solveNow: () => void;

  // --- session store bridge ---
  hydrate: (data: {
    session: Session;
    undoStack: Command[];
    redoStack: Command[];
    ui: Partial<CubeStore>;
  }) => void;
  newSession: () => void;
}

function freshSession(): Session {
  return { cube: createSolvedCube(), log: [], reference: null };
}

/** sticker ids currently facing `face` (its 9 tiles) */
function faceStickers(session: Session, face: Face): number[] {
  const n = FACE_FRAME[face].n;
  const out: number[] = [];
  for (const c of session.cube.cubies) {
    if (c.pos[0] * n[0] + c.pos[1] * n[1] + c.pos[2] * n[2] !== 1) continue;
    for (const s of c.stickers) {
      const w = applyVec(c.R, s.localNormal);
      if (w[0] === n[0] && w[1] === n[1] && w[2] === n[2]) out.push(s.id);
    }
  }
  return out;
}

function findStrokeItems(session: Session, stickerIds: number[]): StrokeItem[] {
  const wanted = new Set(stickerIds);
  const items: StrokeItem[] = [];
  for (const c of session.cube.cubies) {
    for (const s of c.stickers) {
      if (!wanted.has(s.id)) continue;
      for (const st of s.strokes) items.push({ stickerId: s.id, stroke: st });
    }
  }
  return items;
}

export const useCubeStore = create<CubeStore>((set, get) => ({
  session: freshSession(),
  version: 0,
  busy: 'idle',
  turnBatches: [],
  animating: false,
  undoStack: [],
  redoStack: [],

  activeFace: 'F',
  turnFace: 'F',
  mode: 'idle',
  penDown: false,
  cursor: { u: 1.5, v: 1.5, visible: false },
  speed: 2,
  plotting: { status: 'idle', stage: '', progress: 0 },
  banner: null,
  knobFlash: null,
  sessionRestored: false,
  pendingPlotResume: null,
  manualItems: [],

  // --- turns ---

  enqueueTurns: (tokens, opts = {}) => {
    const { busy } = get();
    if (busy === 'plotting') {
      get().flashTurnKnob();
      return false; // turns are blocked mid-plot
    }
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
    const stillBusy = remaining.length > 0;
    // solved celebration check
    let banner = state.banner;
    if (
      session.reference &&
      matchesReference(session.cube, session.reference) &&
      done.label === 'solve'
    ) {
      banner = { text: 'SOLVED — artwork restored', at: Date.now() };
    }
    set({ turnBatches: remaining, busy: stillBusy ? 'turning' : 'idle', banner });
  },

  markAnimating: (v) => set({ animating: v }),

  // --- history ---

  pushCommand: (cmd) => {
    set((s) => {
      const undoStack = [...s.undoStack, cmd].slice(-MAX_HISTORY);
      return { undoStack, redoStack: [] };
    });
  },

  undo: () => {
    const s = get();
    if (s.busy === 'plotting') return; // caller aborts plot first
    const cmd = s.undoStack[s.undoStack.length - 1];
    if (!cmd) return;
    if (cmd.kind === 'moves') {
      // animated inverse replay: no log append, truncate afterwards
      const ok = get().enqueueTurns(inverseOf(cmd.tokens), {
        log: false,
        undoable: false,
        truncateLog: cmd.tokens.length,
        fast: cmd.tokens.length > 8,
        label: 'undo',
      });
      if (!ok) return;
      set((st) => ({
        undoStack: st.undoStack.slice(0, -1),
        redoStack: [...st.redoStack, cmd],
      }));
      return;
    }
    // instant commands
    const session = s.session;
    switch (cmd.kind) {
      case 'addStrokes':
        for (const it of cmd.items) removeItem(session, it);
        break;
      case 'removeStrokes':
        for (const it of cmd.items) addItem(session, it);
        break;
      case 'setReference':
        session.reference = cmd.prev;
        break;
    }
    set({
      session,
      version: s.version + 1,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
    });
  },

  redo: () => {
    const s = get();
    if (s.busy === 'plotting') return;
    const cmd = s.redoStack[s.redoStack.length - 1];
    if (!cmd) return;
    if (cmd.kind === 'moves') {
      const ok = get().enqueueTurns(cmd.tokens, {
        log: true,
        undoable: false,
        fast: cmd.tokens.length > 8,
        label: 'redo',
      });
      if (!ok) return;
      set((st) => ({
        redoStack: st.redoStack.slice(0, -1),
        undoStack: [...st.undoStack, cmd],
      }));
      return;
    }
    const session = s.session;
    switch (cmd.kind) {
      case 'addStrokes':
        for (const it of cmd.items) addItem(session, it);
        break;
      case 'removeStrokes':
        for (const it of cmd.items) removeItem(session, it);
        break;
      case 'setReference':
        session.reference = cmd.next;
        break;
    }
    set({
      session,
      version: s.version + 1,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, cmd],
    });
  },

  // --- strokes ---

  appendPlotStrokes: (items) => {
    const session = get().session;
    for (const it of items) addItem(session, it);
    // no version bump: textures are drawn incrementally by the PlotSession
  },

  commitPlotBatch: (items) => {
    if (items.length === 0) return;
    get().pushCommand({ kind: 'addStrokes', items });
  },

  setReferenceNow: () => {
    const s = get();
    const prev = s.session.reference;
    const next = snapshotReference(s.session.cube, s.session.log.length);
    s.session.reference = next;
    set({ session: s.session, version: s.version + 1 });
    get().pushCommand({ kind: 'setReference', prev, next });
  },

  clearActiveFace: () => {
    const s = get();
    const ids = faceStickers(s.session, s.activeFace);
    const items = findStrokeItems(s.session, ids);
    if (items.length === 0) return;
    for (const it of items) removeItem(s.session, it);
    set({ session: s.session, version: s.version + 1 });
    get().pushCommand({ kind: 'removeStrokes', items });
    set({ banner: { text: 'Face cleared', at: Date.now() } });
  },

  clearAllStrokes: () => {
    const s = get();
    const items = findStrokeItems(
      s.session,
      s.session.cube.cubies.flatMap((c) => c.stickers.map((st) => st.id)),
    );
    if (items.length === 0) return;
    for (const it of items) removeItem(s.session, it);
    set({ session: s.session, version: s.version + 1 });
    get().pushCommand({ kind: 'removeStrokes', items });
    set({ banner: { text: 'Shaken clean', at: Date.now() } });
  },

  eraseNear: (face, u, v, radius) => {
    const s = get();
    // erase any stroke whose face-space extent passes near the cursor
    const items: StrokeItem[] = [];
    const seen = new Set<number>();
    for (const c of s.session.cube.cubies) {
      for (const sticker of c.stickers) {
        for (const st of sticker.strokes) {
          if (seen.has(st.id)) continue;
          seen.add(st.id);
          if (strokeNearPoint(c, sticker, st, face, u, v, radius)) {
            items.push({ stickerId: sticker.id, stroke: st });
          }
        }
      }
    }
    if (items.length === 0) return;
    for (const it of items) removeItem(s.session, it);
    set({ session: s.session, version: s.version + 1 });
    get().pushCommand({ kind: 'removeStrokes', items });
  },

  // --- experienced mode ---

  togglePen: () => {
    const s = get();
    if (s.mode !== 'pen') return; // M enters/experiences the mode; D only acts in it
    if (s.penDown) {
      get().commitManualStroke();
      set({ penDown: false });
    } else {
      set({ penDown: true, cursor: { ...s.cursor, visible: true }, manualItems: [] });
    }
  },

  nudgeCursor: (du, dv) => {
    const s = get();
    const u = clamp(s.cursor.u + du, 0, 3);
    const v = clamp(s.cursor.v + dv, 0, 3);
    get().setCursor(u, v);
  },

  setCursor: (u, v) => {
    const s = get();
    const cu = clamp(u, 0, 3);
    const cv = clamp(v, 0, 3);
    if (s.penDown && s.mode === 'pen') {
      // draw a segment from the previous position through the splitter
      const seg = [s.cursor.u, s.cursor.v, cu, cv];
      const subs = splitPolylineOnFace(s.session.cube, s.activeFace, seg, {
        weight: 1,
        travel: false,
      });
      if (subs.length > 0) {
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
        // extend the previous per-tile run when the pen stays on the same tile
        mergeManualRuns(s.manualItems, items);
        set({ manualItems: [...s.manualItems] });
        // notify scene (subscription via version)
        set((st) => ({ version: st.version + 1 }));
      }
    }
    set({ cursor: { u: cu, v: cv, visible: true } });
  },

  commitManualStroke: () => {
    const s = get();
    if (s.manualItems.length > 0) {
      get().pushCommand({ kind: 'addStrokes', items: s.manualItems });
      set({ manualItems: [] });
    }
  },

  // --- ui ---

  setUI: (partial) => set(partial as Partial<CubeStore> & { penDown?: boolean }),

  cycleActiveFace: (dir = 1) => {
    const i = FACES.indexOf(get().activeFace);
    const n = FACES.length;
    set({ activeFace: FACES[(i + dir + n) % n] });
  },

  cycleTurnFace: (dir = 1) => {
    const i = FACES.indexOf(get().turnFace);
    const n = FACES.length;
    set({ turnFace: FACES[(i + dir + n) % n] });
  },

  flashTurnKnob: () => set({ knobFlash: { which: 'turn', at: Date.now() } }),

  clearBanner: () => set({ banner: null }),

  // --- macro ---

  scrambleNow: (seed = Date.now() % 2147483647) => {
    const tokens = generateScramble(seed);
    get().enqueueTurns(tokens, { fast: true, label: 'scramble' });
    set({ banner: { text: 'Scrambled — solve to restore the art', at: Date.now() } });
  },

  solveNow: () => {
    const s = get();
    if (!s.session.reference) {
      set({ banner: { text: 'No reference yet — sketch something first', at: Date.now() } });
      return;
    }
    const pending = movesSinceReference(s.session);
    if (pending.length === 0 && matchesReference(s.session.cube, s.session.reference!)) {
      set({ banner: { text: 'Already solved', at: Date.now() } });
      return;
    }
    const inverse = inverseOf(pending);
    get().enqueueTurns(inverse, {
      fast: true,
      undoable: false,
      truncateLog: pending.length,
      label: 'solve',
    });
  },

  // --- session bridge ---

  hydrate: ({ session, undoStack, redoStack, ui }) => {
    checkInvariants(session.cube);
    set({
      session,
      undoStack,
      redoStack,
      version: get().version + 1,
      sessionRestored: true,
      ...(ui as Partial<CubeStore>),
    });
  },

  newSession: () => {
    set({
      session: freshSession(),
      undoStack: [],
      redoStack: [],
      turnBatches: [],
      busy: 'idle',
      version: get().version + 1,
      manualItems: [],
      penDown: false,
      mode: 'idle',
      plotting: { status: 'idle', stage: '', progress: 0 },
      banner: { text: 'New session', at: Date.now() },
    });
  },
}));

// --- helpers ----------------------------------------------------------------

function removeItem(session: Session, item: StrokeItem): void {
  for (const c of session.cube.cubies) {
    for (const s of c.stickers) {
      if (s.id !== item.stickerId) continue;
      const idx = s.strokes.indexOf(item.stroke);
      if (idx !== -1) s.strokes.splice(idx, 1);
      return;
    }
  }
}

function addItem(session: Session, item: StrokeItem): void {
  for (const c of session.cube.cubies) {
    for (const s of c.stickers) {
      if (s.id === item.stickerId) {
        if (!s.strokes.includes(item.stroke)) s.strokes.push(item.stroke);
        return;
      }
    }
  }
}

/**
 * Manual pen: consecutive splitter outputs on the same sticker extend that
 * run instead of piling up micro-strokes.
 */
function mergeManualRuns(existing: StrokeItem[], fresh: StrokeItem[]): void {
  for (const f of fresh) {
    const last = existing[existing.length - 1];
    if (last && last.stickerId === f.stickerId) {
      last.stroke.pts.push(...f.stroke.pts.slice(2));
    } else {
      existing.push(f);
    }
  }
}

/** does this stroke pass near face point (u,v) within radius? */
function strokeNearPoint(
  cubie: import('../core/cubeState').Cubie,
  sticker: import('../core/stickers').Sticker,
  stroke: import('../core/stickers').Stroke,
  face: Face,
  u: number,
  v: number,
  radius: number,
): boolean {
  // only stickers currently on this face can be erased from it
  const w = applyVec(cubie.R, sticker.localNormal);
  const n = FACE_FRAME[face].n;
  if (w[0] !== n[0] || w[1] !== n[1] || w[2] !== n[2]) return false;
  for (let i = 0; i < stroke.pts.length; i += 2) {
    const p = tileToFace(cubie, sticker, stroke.pts[i], stroke.pts[i + 1]);
    if (p.face !== face) continue;
    const du = p.u - u;
    const dv = p.v - v;
    if (du * du + dv * dv <= radius * radius) return true;
  }
  return false;
}
