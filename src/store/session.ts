/**
 * Session memory store — automatic pause & resume via localStorage.
 *
 * Debounced autosave (~500ms after state settles), immediate flush on tab
 * hide/unload. On boot: restore everything; if a plot was mid-flight, park it
 * as `pendingPlotResume` for the user to continue or keep as partial art.
 * Distinct from the manual Save/Load FILE flow (shareable snapshot).
 */

import { useCubeStore } from './useCubeStore';
import type { PlottingStatus } from './useCubeStore';
import {
  serializeSession,
  deserializeSession,
  serializePlot,
  hydratePlot,
} from '../core/serialize';
import type { PlotWire } from '../core/serialize';
import { currentPlot, resumePlot } from '../plotting/PlotSession';

const KEY = 'twistdraw.session.v1';
const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

export function installSessionStore(): void {
  if (installed) return;
  installed = true;

  // restore-on-boot
  restoreSession();

  // debounced autosave on every store change
  useCubeStore.subscribe(() => {
    scheduleSave();
  });

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    saveSession();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // mid-turn state is not serialized — warn before losing it
  window.addEventListener('beforeunload', (e) => {
    flush();
    if (useCubeStore.getState().busy === 'turning') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    saveSession();
  }, DEBOUNCE_MS);
}

export function saveSession(): void {
  try {
    const s = useCubeStore.getState();
    if (s.busy !== 'idle' && s.busy !== 'plotting') return; // never save mid-turn
    const plot = currentPlot();
    const plotWire: PlotWire | null =
      plot && useCubeStore.getState().busy === 'plotting'
        ? serializePlot(plot.plan, plot.drawnLen, plot.items)
        : null;
    const wire = serializeSession(
      s.session,
      s.undoStack,
      s.redoStack,
      {
        activeFace: s.activeFace,
        turnFace: s.turnFace,
        mode: s.mode,
        penDown: s.penDown,
        speed: s.speed,
        complexity: s.complexity,
        cursor: s.cursor,
      },
      plotWire,
    );
    localStorage.setItem(KEY, JSON.stringify(wire));
  } catch (err) {
    // quota or serialization failure: keep going in-memory
    console.warn('[twistdraw] session autosave failed:', err);
  }
}

export function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = deserializeSession(JSON.parse(raw));
    const store = useCubeStore.getState();
    store.hydrate({
      session: parsed.session,
      undoStack: parsed.undoStack,
      redoStack: parsed.redoStack,
      ui: {
        activeFace: parsed.ui.activeFace as never,
        turnFace: parsed.ui.turnFace as never,
        mode: parsed.ui.mode as never,
        penDown: parsed.ui.penDown,
        speed: parsed.ui.speed,
        complexity: parsed.ui.complexity as never,
        cursor: parsed.ui.cursor,
        plotting: { status: 'idle', stage: '', progress: 0 } satisfies PlottingStatus,
        sessionRestored: true,
        pendingPlotResume: parsed.plot ? hydratePlot(parsed.plot, parsed.session) : null,
      },
    });
    return true;
  } catch (err) {
    console.warn('[twistdraw] session restore failed:', err);
    return false;
  }
}

export function clearStoredSession(): void {
  localStorage.removeItem(KEY);
}

/** continue a parked mid-flight plot */
export function resumePendingPlot(): boolean {
  const s = useCubeStore.getState();
  const pending = s.pendingPlotResume as ReturnType<typeof hydratePlot> | null;
  if (!pending) return false;
  const ok = resumePlot(pending.plan, pending.drawnLen, pending.items);
  if (ok) {
    useCubeStore.setState({ pendingPlotResume: null });
  }
  return ok;
}

/** decline the parked plot: keep its strokes as committed partial art */
export function discardPendingPlot(): void {
  const s = useCubeStore.getState();
  const pending = s.pendingPlotResume as ReturnType<typeof hydratePlot> | null;
  if (!pending) return;
  if (pending.items.length > 0) {
    s.commitPlotBatch(pending.items);
  }
  useCubeStore.setState({
    pendingPlotResume: null,
    banner: { text: 'Partial etch kept', at: Date.now() },
  });
}
