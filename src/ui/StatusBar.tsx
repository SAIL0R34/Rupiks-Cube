/**
 * StatusBar — plotting progress (worker stages → etch animation), session
 * note, the etch speed control, and the resume-or-keep prompt for a parked
 * mid-flight plot.
 */

import { useCubeStore } from '../store/useCubeStore';
import { resumePendingPlot, discardPendingPlot } from '../store/session';

export function StatusBar(): JSX.Element {
  const plotting = useCubeStore((s) => s.plotting);
  const speed = useCubeStore((s) => s.speed);
  const setUI = useCubeStore((s) => s.setUI);
  const sessionRestored = useCubeStore((s) => s.sessionRestored);
  const pendingPlotResume = useCubeStore((s) => s.pendingPlotResume);
  const busy = useCubeStore((s) => s.busy);

  const active = plotting.status !== 'idle';
  const hasPendingPlot = pendingPlotResume != null && busy === 'idle';

  return (
    <div className="status-bar">
      {hasPendingPlot && (
        <div className="resume-prompt">
          <div className="resume-note">unfinished etch found</div>
          <div className="resume-row">
            <button className="accent" onClick={() => resumePendingPlot()}>
              resume plotting
            </button>
            <button onClick={() => discardPendingPlot()}>keep partial</button>
          </div>
        </div>
      )}
      {active && (
        <div className="plot-progress">
          <div className="plot-stage">
            {plotting.status === 'processing' ? plotting.stage || 'working…' : 'etching…'}
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round((plotting.status === 'processing' ? plotting.progress : plotting.progress) * 100)}%` }}
            />
          </div>
        </div>
      )}
      <div className="speed-row">
        <span className="speed-label">speed</span>
        {[1, 2, 4, 8].map((v) => (
          <button
            key={v}
            className={`speed-btn ${speed === v ? 'on' : ''}`}
            onClick={() => setUI({ speed: v })}
          >
            {v}×
          </button>
        ))}
      </div>
      {sessionRestored && <div className="restored-note">session restored</div>}
    </div>
  );
}
