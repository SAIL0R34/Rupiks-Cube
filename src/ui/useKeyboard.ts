/**
 * Keyboard map — the whole cube on keys:
 *
 *   U D L R F B   twist that face (+⇧ = the other way)
 *   M E S         twist the middle slices
 *   Space         scramble · Enter solve
 *   ⌘Z / ⇧⌘Z      undo / redo · ?  help · Esc close
 */

import { useEffect } from 'react';
import { useCubeStore } from '../store/useCubeStore';
import type { MoveToken } from '../core/moves';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';

const LETTER_FACES: Record<string, Face | 'M' | 'E' | 'S'> = {
  u: 'U',
  d: 'D',
  l: 'L',
  r: 'R',
  f: 'F',
  b: 'B',
  m: 'M',
  e: 'E',
  s: 'S',
};

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const s = useCubeStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        s.scrambleNow();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        s.solveNow();
        return;
      }
      if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) {
        // timer toggle (letters below skip when modifiers are held)
        s.setTimerOn(!useCubeStore.getState().timerOn);
        return;
      }
      if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey) {
        s.toggleTimerPause();
        return;
      }

      const mapped = LETTER_FACES[e.key.toLowerCase()];
      if (mapped) {
        if (useCubeStore.getState().busy !== 'idle') return;
        const base = mapped as string;
        const token = (e.shiftKey ? `${base}'` : base) as MoveToken;
        s.enqueueTurns([token], { label: 'key' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export { FACES };
