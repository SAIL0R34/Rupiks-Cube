/**
 * Onboarding — the 6-slot face picker (cube-net layout) shown until every
 * face has an image. Doubles as the single-face repaint picker when
 * `repaintFace` is set.
 */

import { useRef, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';
import { toSquareDataUrl, loadBitmap } from '../imaging/compose';

const NET: Array<{ face: Face; col: number; row: number }> = [
  { face: 'U', col: 1, row: 0 },
  { face: 'L', col: 0, row: 1 },
  { face: 'F', col: 1, row: 1 },
  { face: 'R', col: 2, row: 1 },
  { face: 'B', col: 3, row: 1 },
  { face: 'D', col: 1, row: 2 },
];

const FACE_NAMES: Record<Face, string> = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
  F: 'front',
  B: 'back',
};

export function Onboarding(): JSX.Element | null {
  const session = useCubeStore((s) => s.session);
  const startPuzzle = useCubeStore((s) => s.startPuzzle);
  const setFaceImage = useCubeStore((s) => s.setFaceImage);
  const repaintFace = useCubeStore((s) => s.repaintFace);
  const setRepaintFace = useCubeStore((s) => s.setRepaintFace);
  const [picks, setPicks] = useState<Partial<Record<Face, string>>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<Face | null>(null);

  const images = { ...session.images, ...picks };
  const complete = FACES.every((f) => typeof images[f] === 'string');
  const single = repaintFace !== null;

  if (!single && hasAllImages(session)) return null; // done onboarding

  const pickFile = (face: Face) => {
    slotRef.current = face;
    fileRef.current?.click();
  };

  const onFile = async (file: File) => {
    const face = slotRef.current;
    if (!face) return;
    const bitmap = await loadBitmap(file);
    const squareUrl = toSquareDataUrl(bitmap, 'contain');
    if (single) {
      setBusy(true);
      await setFaceImage(face, squareUrl);
      setBusy(false);
      setRepaintFace(null);
    } else {
      setPicks((p) => ({ ...p, [face]: squareUrl }));
    }
  };

  const fillAll = async () => {
    const first = FACES.find((f) => typeof images[f] === 'string');
    if (!first) return;
    const src = images[first]!;
    const next: Partial<Record<Face, string>> = {};
    for (const f of FACES) next[f] = src;
    setPicks(next);
  };

  const start = async () => {
    setBusy(true);
    await startPuzzle(images as Record<Face, string>);
    setBusy(false);
  };

  return (
    <div className="onboarding">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = '';
        }}
      />
      <div className="onboarding-card">
        <h1 className="brand">TwistDraw Cube</h1>
        <p className="lede">
          {single
            ? `Choose a new picture for the ${FACE_NAMES[repaintFace!]} face.`
            : 'Give every face a picture — then scramble the cube and twist it back.'}
        </p>
        <div className="net-picker">
          {NET.map(({ face, col, row }) => {
            const img = images[face];
            const isTarget = single && repaintFace === face;
            return (
              <button
                key={face}
                className={`net-slot ${img ? 'filled' : ''} ${isTarget ? 'target' : ''} ${single && !isTarget ? 'dim' : ''}`}
                style={{ gridColumn: col + 1, gridRow: row + 1 }}
                onClick={() => pickFile(face)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  slotRef.current = face;
                  if (file) void onFile(file);
                }}
              >
                {img ? (
                  <img src={img} alt={`${FACE_NAMES[face]} face`} />
                ) : (
                  <span className="slot-hint">{face}</span>
                )}
                <span className="slot-name">{FACE_NAMES[face]}</span>
              </button>
            );
          })}
        </div>
        <div className="onboarding-actions">
          {!single && (
            <>
              <button className="ghost" onClick={() => void fillAll()} disabled={!complete}>
                use one picture everywhere
              </button>
              <button className="primary" onClick={() => void start()} disabled={!complete || busy}>
                {busy ? 'placing…' : complete ? 'start twisting' : `pick ${6 - FACES.filter((f) => images[f]).length} more`}
              </button>
            </>
          )}
          {single && (
            <button className="ghost" onClick={() => setRepaintFace(null)}>
              cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
