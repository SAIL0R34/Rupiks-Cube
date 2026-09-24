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

  const btn = (label: string, title: string, dTheta = 0, dPhi = 0, reset = false) => (
    <button
      className="view-btn"
      title={title}
      aria-label={title}
      onClick={() => (reset ? emit('camera-reset', {}) : emit('camera-orbit', { dTheta, dPhi }))}
    >
      {label}
    </button>
  );

  return (
    <div className="view-controls" role="group" aria-label="rotate view">
      <div className="view-col">
        {btn('▲', 'tilt view up', 0, STEP)}
        {btn('▼', 'tilt view down', 0, -STEP)}
      </div>
      <div className="view-col">
        {btn('◀', 'orbit view left', STEP)}
        {btn('▶', 'orbit view right', -STEP)}
        {btn('⌂', 'reset view', 0, 0, true)}
      </div>
    </div>
  );
}
