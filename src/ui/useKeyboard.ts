/**
 * Global keyboard map — the canonical TwistDraw controls. Single remappable
 * table; see HelpOverlay for the user-facing cheatsheet.
 *
 *   1–6 / [ ]   K1 face select        Space / ⇧Space / X   K2 turn CW/CCW/2
 *   arrows      K3/K4 cursor           ⇧ ×5 coarse, ⌥ ×0.25 fine
 *   M           Experienced Mode       D                    pen down/up
 *   E           erase mode             C / 0                clear face / shake all
 *   A / ⇧A      cycle active face      L                    look at active face
 *   U           upload sketch          Esc                  abort plot
 *   + / −       plot speed 1–8×        ⌘Z / ⇧⌘Z             undo / redo
 */

import { useEffect } from 'react';
import { useCubeStore } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';
import { emit } from '../utils/bus';

const CURSOR_STEP = 0.02;

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

      switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6': {
          const face = FACES[Number(e.key) - 1] as Face;
          s.setUI({ turnFace: face });
          return;
        }
        case '[':
          s.cycleTurnFace(-1);
          return;
        case ']':
          s.cycleTurnFace(1);
          return;
        case ' ':
          e.preventDefault();
          if (s.busy === 'plotting') {
            s.flashTurnKnob();
            return;
          }
          s.enqueueTurns([e.shiftKey ? `${s.turnFace}'` : s.turnFace], { label: 'turn' });
          return;
        case 'x':
        case 'X': {
          if (s.busy === 'plotting') {
            s.flashTurnKnob();
            return;
          }
          s.enqueueTurns([`${s.turnFace}2`], { label: 'turn' });
          return;
        }
        case 'ArrowLeft':
          e.preventDefault();
          s.nudgeCursor(-cursorMult(e), 0);
          return;
        case 'ArrowRight':
          e.preventDefault();
          s.nudgeCursor(cursorMult(e), 0);
          return;
        case 'ArrowDown':
          e.preventDefault();
          s.nudgeCursor(0, -cursorMult(e));
          return;
        case 'ArrowUp':
          e.preventDefault();
          s.nudgeCursor(0, cursorMult(e));
          return;
        case 'm':
        case 'M':
          s.setUI({ mode: s.mode === 'pen' ? 'idle' : 'pen', penDown: false });
          if (s.mode !== 'pen') s.setUI({ cursor: { ...s.cursor, visible: true } });
          return;
        case 'd':
        case 'D':
          s.togglePen();
          return;
        case 'e':
        case 'E':
          s.setUI({ mode: s.mode === 'erase' ? 'idle' : 'erase', penDown: false });
          if (s.mode !== 'erase') s.setUI({ cursor: { ...s.cursor, visible: true } });
          return;
        case 'c':
        case 'C':
          if (window.confirm('Clear the active face?')) s.clearActiveFace();
          return;
        case '0':
          if (window.confirm('Shake the whole cube clean?')) s.clearAllStrokes();
          return;
        case 'a':
        case 'A':
          s.cycleActiveFace(e.shiftKey ? -1 : 1);
          return;
        case 'l':
        case 'L':
          emit('camera-look', { face: useCubeStore.getState().activeFace });
          return;
        case 'u':
        case 'U':
          emit('upload-request', {});
          return;
        case 'Escape':
          emit('abort-plot', {});
          return;
        case '+':
        case '=':
          s.setUI({ speed: Math.min(8, s.speed + 1) });
          return;
        case '-':
        case '_':
          s.setUI({ speed: Math.max(1, s.speed - 1) });
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function cursorMult(e: KeyboardEvent): number {
  if (e.shiftKey) return CURSOR_STEP * 5;
  if (e.altKey) return CURSOR_STEP * 0.25;
  return CURSOR_STEP;
}
