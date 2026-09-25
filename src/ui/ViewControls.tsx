/**
 * ViewControls — orbit-the-view buttons, so rotating the camera never
 * competes with twist gestures on the cube itself.
 */

import { emit } from '../utils/bus';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';

const STEP = Math.PI / 5; // 36° per press

export function ViewControls(): JSX.Element | null {
  const started = useCubeStore((s) => hasAllImages(s.session));
  if (!started) return null;

  const btn = (label: string, tip: string, dTheta = 0, dPhi = 0, reset = false) => (
    <button
      className="view-btn"
      data-tip={tip}
      aria-label={tip}
      onClick={() => (reset ? emit('camera-reset', {}) : emit('camera-orbit', { dTheta, dPhi }))}
    >
      {label}
    </button>
  );

  return (
    <div className="view-controls" role="group" aria-label="rotate view">
      <div className="view-col">
        {btn('▲', 'tilt the view up', 0, STEP)}
        {btn('▼', 'tilt the view down', 0, -STEP)}
      </div>
      <div className="view-col">
        {btn('◀', 'spin the view left — never twists the cube', STEP)}
        {btn('▶', 'spin the view right — never twists the cube', -STEP)}
        {btn('⌂', 'reset the view', 0, 0, true)}
      </div>
    </div>
  );
}
