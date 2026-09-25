/**
 * Onboarding — the 6-slot face picker (cube-net layout) shown until every
 * face has an image. Uploads are the primary path; the free public-domain
 * starter pack is offered alongside (click a thumbnail to fill the next
 * empty slot, or shuffle the pack onto all faces). Doubles as the
 * single-face repaint picker when `repaintFace` is set.
 */

import { useRef, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';
import { toSquareDataUrl, loadBitmap, decodeDataUrl } from '../imaging/compose';
import { DEMO_IMAGES, samplePack } from '../imaging/demoPack';

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

  /** apply a picture (upload dataURL or demo URL) to a face */
  const applyToFace = async (face: Face, source: string) => {
    if (single) {
      setBusy(true);
      await setFaceImage(face, source);
      setBusy(false);
      setRepaintFace(null);
    } else {
      setPicks((p) => ({ ...p, [face]: source }));
    }
  };

  const onFile = async (file: File) => {
    const face = slotRef.current;
    if (!face) return;
    const bitmap = await loadBitmap(file);
    await applyToFace(face, toSquareDataUrl(bitmap, 'contain'));
  };

  /**
   * Demo pictures are cover-cropped to a square at pick time — the artworks
   * fill their faces edge-to-edge with no letterbox bands (an already-square
   * image composed later with 'contain' is an identity, so nothing downstream
   * can reintroduce borders).
   */
  const coverSquare = async (url: string): Promise<string> =>
    toSquareDataUrl(await decodeDataUrl(url), 'cover');

  /** demo thumbnail → next empty slot (or the repaint target) */
  const useDemo = async (file: string) => {
    const squared = await coverSquare(file);
    if (single) {
      await applyToFace(repaintFace!, squared);
      return;
    }
    const nextEmpty = FACES.find((f) => typeof images[f] !== 'string');
    if (nextEmpty) await applyToFace(nextEmpty, squared);
  };

  const shufflePack = async () => {
    const picks6 = samplePack(6);
    const squared = await Promise.all(picks6.map((p) => coverSquare(p.file)));
    const next: Partial<Record<Face, string>> = {};
    FACES.forEach((f, i) => {
      next[f] = squared[i];
    });
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
        <h1 className="brand">Rupiks Cube</h1>
        <p className="lede">
          {single
            ? `Choose a new picture for the ${FACE_NAMES[repaintFace!]} face — upload one or pick from the pack.`
            : 'Put a picture on each face — your own, or the free starter pack below. Then scramble the cube and twist it back.'}
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

        <div className="demo-pack">
          <div className="demo-head">
            <span className="demo-label">free starter pack — public-domain art</span>
            {!single && (
              <button className="ghost demo-shuffle" onClick={() => void shufflePack()}>
                shuffle onto all faces
              </button>
            )}
          </div>
          <div className="demo-strip">
            {DEMO_IMAGES.map((d) => (
              <button
                key={d.file}
                className="demo-thumb"
                title={`${d.title} — ${d.artist}`}
                onClick={() => void useDemo(d.file)}
              >
                <img src={d.file} alt={`${d.title} by ${d.artist}`} loading="lazy" />
              </button>
            ))}
          </div>
        </div>

        <div className="onboarding-actions">
          {!single && (
            <>
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
