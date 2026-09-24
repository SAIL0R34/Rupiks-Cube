/**
 * Session memory store — automatic pause & resume via localStorage.
 *
 * Debounced autosave, immediate flush on tab hide/unload. On boot: restore.
 * Old v1 key (etch era) is cleared.
 */

import { useCubeStore } from './useCubeStore';
import { serializeSession, deserializeSession } from '../core/serialize';

const KEY = 'twistdraw.session.v2';
const LEGACY_KEY = 'twistdraw.session.v1';
const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let quotaWarned = false;

export function installSessionStore(): void {
  if (installed) return;
  installed = true;

  restoreSession();

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
    if (s.busy !== 'idle') return; // never save mid-turn
    const wire = serializeSession(s.session, s.undoStack, s.redoStack);
    localStorage.setItem(KEY, JSON.stringify(wire));
    quotaWarned = false;
  } catch (err) {
    console.warn('[twistdraw] session autosave failed:', err);
    if (!quotaWarned) {
      quotaWarned = true;
      useCubeStore.setState({
        banner: { text: 'Autosave failed (storage full?) — use Save file', at: Date.now() },
      });
    }
  }
}

export function restoreSession(): boolean {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = deserializeSession(JSON.parse(raw));
    useCubeStore.getState().hydrate({
      session: parsed.session,
      undoStack: parsed.undoStack,
      redoStack: parsed.redoStack,
    });
    return true;
  } catch (err) {
    console.warn('[twistdraw] session restore failed:', err);
    return false;
  }
}

export function clearStoredSession(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
}
