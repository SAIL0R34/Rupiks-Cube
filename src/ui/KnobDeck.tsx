/**
 * KnobDeck — the four canonical knobs:
 *   K1 detent  — turn-face selector (6 positions)
 *   K2 crank   — each 90° of cranking turns that face CW/CCW
 *   K3 geared  — cursor X (3 revolutions = one face traversal)
 *   K4 geared  — cursor Y
 * K3/K4 are views of the cursor: dragging moves the cursor; while the machine
 * plots, they rotate along. A turn attempt mid-plot flashes K2.
 */

import { useEffect, useState } from 'react';
import { Knob } from './Knob';
import { useCubeStore } from '../store/useCubeStore';
import { FACES } from '../core/faces';
import type { Face } from '../core/faces';

export function KnobDeck(): JSX.Element {
  const turnFace = useCubeStore((s) => s.turnFace);
  const setUI = useCubeStore((s) => s.setUI);
  const enqueueTurns = useCubeStore((s) => s.enqueueTurns);
  const cursor = useCubeStore((s) => s.cursor);
  const setCursor = useCubeStore((s) => s.setCursor);
  const busy = useCubeStore((s) => s.busy);
  const knobFlash = useCubeStore((s) => s.knobFlash);
  const [flashOn, setFlashOn] = useState(false);

  useEffect(() => {
    if (!knobFlash) return;
    setFlashOn(true);
    const t = setTimeout(() => setFlashOn(false), 350);
    return () => clearTimeout(t);
  }, [knobFlash]);

  const faceIndex = FACES.indexOf(turnFace);

  return (
    <div className="knob-deck" onContextMenu={(e) => e.preventDefault()}>
      <Knob
        mode="detent"
        label="K1 · face"
        steps={FACES.length}
        index={faceIndex}
        labels={FACES as unknown as string[]}
        onIndex={(i) => setUI({ turnFace: FACES[i] as Face })}
      />
      <Knob
        mode="crank"
        label="K2 · turn"
        disabled={busy === 'plotting'}
        flashing={flashOn}
        onQuarter={(dir) => {
          const token = dir === 1 ? turnFace : (`${turnFace}'` as const);
          enqueueTurns([token], { label: 'turn' });
        }}
      />
      <Knob
        mode="geared"
        label="K3 · cursor X"
        revolutions={3}
        position={cursor.u / 3}
        onPosition={(p) => setCursor(p * 3, cursor.v)}
      />
      <Knob
        mode="geared"
        label="K4 · cursor Y"
        revolutions={3}
        position={cursor.v / 3}
        onPosition={(p) => setCursor(cursor.u, p * 3)}
      />
    </div>
  );
}
