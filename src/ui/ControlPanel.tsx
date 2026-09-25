/**
 * ControlPanel — the simplified primary bar: scramble, solve, undo/redo, and
 * a "more" drawer. The drawer's face swap shows the CURRENT picture on each
 * face; picking one offers the demo pack + upload right there.
 */

import { useRef, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';
import { toSquareDataUrl, decodeDataUrl } from '../imaging/compose';
import { DEMO_IMAGES } from '../imaging/demoPack';
import { clearStoredSession } from '../store/session';
import { posesMatchReference } from '../core/history';
import { emit } from '../utils/bus';
import { serializeSave, deserializeSave } from '../core/serialize';
import { downloadJSON } from '../utils/download';
import { downloadView } from '../three/viewExport';

const FACE_NAMES: Record<string, string> = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
  F: 'front',
  B: 'back',
};

function faceName(f: string): string {
  return FACE_NAMES[f] ?? f;
}

/** radians per view-rotation press (36°) */
const STEP = Math.PI / 5;

export function ControlPanel(): JSX.Element | null {
  const scrambleNow = useCubeStore((s) => s.scrambleNow);
  const solveNow = useCubeStore((s) => s.solveNow);
  const undo = useCubeStore((s) => s.undo);
  const redo = useCubeStore((s) => s.redo);
  const newSession = useCubeStore((s) => s.newSession);
  const timerOn = useCubeStore((s) => s.timerOn);
  const setTimerOn = useCubeStore((s) => s.setTimerOn);
  const images = useCubeStore((s) => s.session.images);
  const setFaceImage = useCubeStore((s) => s.setFaceImage);
  // swapping mid-scramble is unsolvable by construction — only allow it when
  // the cube sits at its reference poses (the swap then re-defines the puzzle)
  const canSwap = useCubeStore((s) =>
    s.session.reference ? posesMatchReference(s.session, s.session.reference) : true,
  );
  const started = useCubeStore((s) => hasAllImages(s.session));
  const busy = useCubeStore((s) => s.busy);
  const [open, setOpen] = useState(false);
  const [swapFace, setSwapFace] = useState<Face | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  if (!started) return null; // onboarding owns the screen

  const coverSquare = async (url: string): Promise<string> =>
    toSquareDataUrl(await decodeDataUrl(url), 'cover');

  const saveFile = () => {
    downloadJSON(serializeSave(useCubeStore.getState().session), 'rupiks-cube.json');
  };

  const applyPicture = async (source: string) => {
    if (!swapFace) return;
    setApplying(true);
    await setFaceImage(swapFace, source);
    setApplying(false);
  };

  return (
    <div className="control-panel">
      <div className="primary-bar">
        <button
          className="cta"
          onClick={() => scrambleNow()}
          disabled={busy !== 'idle'}
          data-tip="shatter the pictures across the cube — Space"
        >
          scramble
        </button>
        <button
          className="good"
          onClick={() => solveNow()}
          disabled={busy !== 'idle'}
          data-tip="twist the cube back to your pictures — Enter"
        >
          solve
        </button>
        <button
          className="ghost"
          onClick={() => undo()}
          aria-label="undo"
          disabled={busy !== 'idle'}
          data-tip="undo (works across scrambles) — ⌘Z"
        >
          ↩
        </button>
        <button
          className="ghost"
          onClick={() => redo()}
          aria-label="redo"
          disabled={busy !== 'idle'}
          data-tip="redo — ⇧⌘Z"
        >
          ↪
        </button>
        <button
          className="ghost"
          onClick={() => {
            setOpen((v) => !v);
            if (open) setSwapFace(null);
          }}
          aria-expanded={open}
          data-tip="swap face pictures · start over"
        >
          more {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div className="drawer">
          <div className="drawer-row">
            <span className="drawer-label">swap a face</span>
            {FACES.map((f) => (
              <button
                key={f}
                className={`face-thumb ${swapFace === f ? 'on' : ''}`}
                data-tip={
                  canSwap
                    ? `new picture for the ${faceName(f)} face`
                    : 'solve the cube first — swapping mid-scramble makes it unsolvable'
                }
                aria-label={`new picture for the ${faceName(f)} face`}
                disabled={!canSwap}
                onClick={() => setSwapFace((cur) => (cur === f ? null : (f as Face)))}
              >
                <img src={images[f as Face] ?? undefined} alt="" />
                <span className="face-thumb-tag">{f}</span>
              </button>
            ))}
          </div>
          {!canSwap && (
            <div className="drawer-row">
              <span className="drawer-note">solve the cube before swapping pictures</span>
            </div>
          )}
          {swapFace && canSwap && (
            <div className="drawer-row repaint-row">
              <span className="drawer-label">{faceName(swapFace)}</span>
              <div className="drawer-demo-strip">
                {DEMO_IMAGES.map((d) => (
                  <button
                    key={d.file}
                    className="drawer-demo-thumb"
                    data-tip={`place “${d.title}” — ${d.artist}`}
                    aria-label={`place ${d.title} by ${d.artist}`}
                    disabled={applying}
                    onClick={() => void applyPicture(d.file)}
                  >
                    <img src={d.file} alt="" loading="lazy" />
                  </button>
                ))}
                <button
                  className="drawer-upload"
                  data-tip="use your own picture"
                  disabled={applying}
                  onClick={() => fileRef.current?.click()}
                >
                  ↑
                </button>
              </div>
              <button className="ghost small" onClick={() => setSwapFace(null)} data-tip="collapse">
                done
              </button>
            </div>
          )}
          <div className="drawer-row">
            <span className="drawer-label">rotate view</span>
            {(
              [
                ['◀', 'orbit view left', 1, 0],
                ['▶', 'orbit view right', -1, 0],
                ['▲', 'tilt view up', 0, 1],
                ['▼', 'tilt view down', 0, -1],
              ] as Array<[string, string, number, number]>
            ).map(([label, tip, dTheta, dPhi]) => (
              <button
                key={tip}
                className="ghost view-mini"
                data-tip={tip}
                aria-label={tip}
                onClick={() => emit('camera-orbit', { dTheta: dTheta * STEP, dPhi: dPhi * STEP })}
              >
                {label}
              </button>
            ))}
            <button
              className="ghost view-mini"
              data-tip="reset the view"
              aria-label="reset the view"
              onClick={() => emit('camera-reset', {})}
            >
              ⌂
            </button>
          </div>
          <div className="drawer-row">
            <button
              className="ghost"
              onClick={() => saveFile()}
              data-tip="download this puzzle as a shareable file"
            >
              save
            </button>
            <button
              className="ghost"
              onClick={() => jsonRef.current?.click()}
              data-tip="open a saved puzzle file"
            >
              load
            </button>
            <button
              className="ghost"
              onClick={() => void downloadView()}
              data-tip="screenshot this exact view"
            >
              png
            </button>
            <button
              className={`ghost ${timerOn ? 'on' : ''}`}
              data-tip="race the clock: scramble → solve (T)"
              aria-pressed={timerOn}
              onClick={() => setTimerOn(!timerOn)}
            >
              timer {timerOn ? 'on' : 'off'}
            </button>
            <button
              className="ghost danger"
              data-tip="fresh cube, fresh pictures"
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
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const url = URL.createObjectURL(file);
                void decodeDataUrl(url)
                  .then((img) => applyPicture(toSquareDataUrl(img, 'contain')))
                  .finally(() => URL.revokeObjectURL(url));
              }
              e.target.value = '';
            }}
          />
          <input
            ref={jsonRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void file.text().then((text) => {
                  try {
                    const session = deserializeSave(JSON.parse(text));
                    useCubeStore.getState().hydrate({
                      session,
                      undoStack: [],
                      redoStack: [],
                    });
                  } catch (err) {
                    useCubeStore.setState({
                      banner: {
                        text: `Load failed: ${err instanceof Error ? err.message : String(err)}`,
                        at: Date.now(),
                      },
                    });
                  }
                });
              }
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
