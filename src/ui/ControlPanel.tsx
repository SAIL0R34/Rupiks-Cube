/**
 * ControlPanel — buttons for everything the knobs don't cover: upload,
 * complexity, scramble/solve, undo/redo, modes, clears, save/load/export.
 */

import { useRef } from 'react';
import { useCubeStore } from '../store/useCubeStore';
import { uploadAndSketch } from '../plotting/uploadFlow';
import type { Complexity } from '../image-processing/types';
import { emit } from '../utils/bus';
import { abortPlot } from '../plotting/PlotSession';
import { serializeSave, deserializeSave } from '../core/serialize';
import { downloadJSON } from '../utils/download';

const COMPLEXITIES: Complexity[] = ['minimal', 'standard', 'obsessed'];

export function ControlPanel(): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const scrambleNow = useCubeStore((s) => s.scrambleNow);
  const solveNow = useCubeStore((s) => s.solveNow);
  const undo = useCubeStore((s) => s.undo);
  const redo = useCubeStore((s) => s.redo);
  const clearActiveFace = useCubeStore((s) => s.clearActiveFace);
  const clearAllStrokes = useCubeStore((s) => s.clearAllStrokes);
  const setUI = useCubeStore((s) => s.setUI);
  const mode = useCubeStore((s) => s.mode);
  const penDown = useCubeStore((s) => s.penDown);
  const togglePen = useCubeStore((s) => s.togglePen);
  const cycleActiveFace = useCubeStore((s) => s.cycleActiveFace);
  const activeFace = useCubeStore((s) => s.activeFace);
  const busy = useCubeStore((s) => s.busy);
  const plotting = useCubeStore((s) => s.plotting);
  const complexity = useCubeStore((s) => s.complexity);

  return (
    <div className="control-panel">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void uploadAndSketch(file, {
              mode: useCubeStore.getState().complexity,
              fit: 'contain',
              clearFaceFirst: true,
            });
          }
          e.target.value = '';
        }}
      />
      <div className="panel-group">
        <button
          className="primary"
          onClick={() =>
            fileRef.current &&
            fileRef.current.click()
          }
          disabled={busy === 'plotting'}
        >
          upload & etch
        </button>
        {plotting.status !== 'idle' && <button onClick={() => abortPlot()}>stop</button>}
        <div className="seg">
          {COMPLEXITIES.map((c) => (
            <button
              key={c}
              className={`seg-btn ${complexity === c ? 'on' : ''}`}
              onClick={() => setUI({ complexity: c })}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-group">
        <button onClick={() => scrambleNow()}>scramble</button>
        <button className="accent" onClick={() => solveNow()}>
          solve
        </button>
        <button onClick={() => undo()}>undo</button>
        <button onClick={() => redo()}>redo</button>
      </div>

      <div className="panel-group">
        <button
          className={mode === 'pen' ? 'on' : ''}
          onClick={() => setUI({ mode: mode === 'pen' ? 'idle' : 'pen', penDown: false })}
        >
          manual mode
        </button>
        <button className={penDown ? 'on' : ''} onClick={() => togglePen()} disabled={mode !== 'pen'}>
          {penDown ? 'pen up' : 'pen down'}
        </button>
        <button
          className={mode === 'erase' ? 'on' : ''}
          onClick={() => setUI({ mode: mode === 'erase' ? 'idle' : 'erase', penDown: false })}
        >
          erase
        </button>
      </div>

      <div className="panel-group">
        <button onClick={() => cycleActiveFace(1)}>draw face: {activeFace}</button>
        <button onClick={() => clearActiveFace()}>clear face</button>
        <button onClick={() => clearAllStrokes()}>shake clean</button>
      </div>

      <div className="panel-group">
        <button onClick={() => saveFile()}>save file</button>
        <button onClick={() => loadRef.current?.click()}>load file</button>
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
    </div>
  );
}

function saveFile(): void {
  const s = useCubeStore.getState();
  const wire = serializeSave(s.session);
  downloadJSON(wire, 'twistdraw-cube.json');
}

async function loadFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const session = deserializeSave(JSON.parse(text));
    useCubeStore.getState().hydrate({
      session,
      undoStack: [],
      redoStack: [],
      ui: { plotting: { status: 'idle', stage: '', progress: 0 } },
    });
    useCubeStore.setState({
      banner: { text: 'Artwork loaded', at: Date.now() },
      pendingPlotResume: null,
    });
  } catch (err) {
    useCubeStore.setState({
      banner: { text: `Load failed: ${err instanceof Error ? err.message : String(err)}`, at: Date.now() },
    });
  }
}

export function triggerUpload(): void {
  emit('upload-request', {});
}
