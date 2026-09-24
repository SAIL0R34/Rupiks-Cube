/**
 * ControlPanel — the simplified primary bar: scramble, solve, undo/redo, and
 * a "more" drawer for the rare stuff (repaint, files, exports, new session).
 */

import { useRef, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';
import { serializeSave, deserializeSave } from '../core/serialize';
import { downloadJSON } from '../utils/download';
import { downloadNetPNG, downloadNetSVG } from '../net/netExport';
import { downloadView } from '../three/viewExport';
import { clearStoredSession } from '../store/session';

export function ControlPanel(): JSX.Element | null {
  const scrambleNow = useCubeStore((s) => s.scrambleNow);
  const solveNow = useCubeStore((s) => s.solveNow);
  const undo = useCubeStore((s) => s.undo);
  const redo = useCubeStore((s) => s.redo);
  const setRepaintFace = useCubeStore((s) => s.setRepaintFace);
  const newSession = useCubeStore((s) => s.newSession);
  const started = useCubeStore((s) => hasAllImages(s.session));
  const busy = useCubeStore((s) => s.busy);
  const [open, setOpen] = useState(false);
  const loadRef = useRef<HTMLInputElement>(null);

  if (!started) return null; // onboarding owns the screen

  const saveFile = () => {
    downloadJSON(serializeSave(useCubeStore.getState().session), 'twistdraw-cube.json');
  };

  const loadFile = async (file: File) => {
    try {
      const session = deserializeSave(JSON.parse(await file.text()));
      useCubeStore.getState().hydrate({
        session,
        undoStack: [],
        redoStack: [],
      });
    } catch (err) {
      useCubeStore.setState({
        banner: { text: `Load failed: ${err instanceof Error ? err.message : String(err)}`, at: Date.now() },
      });
    }
  };

  return (
    <div className="control-panel">
      <div className="primary-bar">
        <button className="cta" onClick={() => scrambleNow()} disabled={busy !== 'idle'}>
          scramble
        </button>
        <button className="good" onClick={() => solveNow()} disabled={busy !== 'idle'}>
          solve
        </button>
        <button className="ghost" onClick={() => undo()} aria-label="undo" disabled={busy !== 'idle'}>
          ↩
        </button>
        <button className="ghost" onClick={() => redo()} aria-label="redo" disabled={busy !== 'idle'}>
          ↪
        </button>
        <button className="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          more {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div className="drawer">
          <div className="drawer-row">
            <span className="drawer-label">face picture</span>
            {FACES.map((f) => (
              <button key={f} className="ghost face-btn" onClick={() => setRepaintFace(f as Face)}>
                {f}
              </button>
            ))}
          </div>
          <div className="drawer-row">
            <button className="ghost" onClick={() => saveFile()}>save file</button>
            <button className="ghost" onClick={() => loadRef.current?.click()}>load file</button>
            <button className="ghost" onClick={() => downloadNetPNG(useCubeStore.getState().session)}>net png</button>
            <button className="ghost" onClick={() => downloadNetSVG(useCubeStore.getState().session)}>net svg</button>
            <button className="ghost" onClick={() => void downloadView()}>view png</button>
          </div>
          <div className="drawer-row">
            <button
              className="ghost danger"
              onClick={() => {
                if (window.confirm('Start over? The current cube and pictures are discarded.')) {
                  clearStoredSession();
                  newSession();
                  setOpen(false);
                }
              }}
            >
              start over
            </button>
          </div>
          <input
            ref={loadRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
