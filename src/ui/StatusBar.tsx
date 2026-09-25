/** StatusBar — banner, solve timer, solve progress, restored note, hints */

import { useEffect, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { matchesReference } from '../core/history';

const RESTORE_NOTE_MS = 4500;

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function StatusBar(): JSX.Element | null {
  const banner = useCubeStore((s) => s.banner);
  const clearBanner = useCubeStore((s) => s.clearBanner);
  const busy = useCubeStore((s) => s.busy);
  const sessionRestored = useCubeStore((s) => s.sessionRestored);
  const timerStartedAt = useCubeStore((s) => s.timerStartedAt);
  const timerAccumMs = useCubeStore((s) => s.timerAccumMs);
  const timerPaused = useCubeStore((s) => s.timerPaused);
  const toggleTimerPause = useCubeStore((s) => s.toggleTimerPause);
  const lastSolveMs = useCubeStore((s) => s.lastSolveMs);
  const bestSolveMs = useCubeStore((s) => s.bestSolveMs);
  const timerOn = useCubeStore((s) => s.timerOn);
  const solving = useCubeStore((s) => busyFromStore(s));
  const started = useCubeStore((s) => hasAllImages(s.session));
  const solved = useCubeStore((s) =>
    s.session.reference ? matchesReference(s.session, s.session.reference) : false,
  );
  // the restore note is transient: a few seconds after a genuine pickup, then gone
  const [showRestoreNote, setShowRestoreNote] = useState(false);
  const [, setTick] = useState(0);

  // live clock while the solve timer runs
  useEffect(() => {
    if (timerStartedAt === null) return;
    const i = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(i);
  }, [timerStartedAt]);

  void timerAccumMs; // displayed via runningElapsed; re-render on change

  useEffect(() => {
    if (!sessionRestored) return;
    setShowRestoreNote(true);
    const t = setTimeout(() => setShowRestoreNote(false), RESTORE_NOTE_MS);
    return () => clearTimeout(t);
  }, [sessionRestored]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => clearBanner(), 3200);
    return () => clearTimeout(t);
  }, [banner, clearBanner]);

  if (!started) return null;

  const runningElapsed =
    timerStartedAt !== null || timerPaused
      ? timerAccumMs + (timerStartedAt !== null ? Date.now() - timerStartedAt : 0)
      : null;

  const showTimer =
    timerOn && (runningElapsed !== null || lastSolveMs !== null || bestSolveMs !== null);

  return (
    <div className="status-bar">
      {banner && <div className="banner" key={banner.at}>{banner.text}</div>}
      {showTimer && (
        <div className="timer-row">
          {runningElapsed !== null ? (
            <>
              <span className={`timer-chip ${timerPaused ? '' : 'running'}`}>
                {timerPaused ? '⏸ ' : ''}{formatMs(runningElapsed)}
              </span>
              <button
                className="timer-toggle"
                onClick={() => toggleTimerPause()}
                aria-label={timerPaused ? 'resume timer' : 'pause timer'}
                data-tip={timerPaused ? 'resume the clock — P' : 'pause the clock — P'}
              >
                {timerPaused ? '▶' : '⏸'}
              </button>
            </>
          ) : lastSolveMs !== null ? (
            <span className="timer-chip">last {formatMs(lastSolveMs)}</span>
          ) : null}
          {bestSolveMs !== null && (
            <span className="timer-best">best {formatMs(bestSolveMs)}</span>
          )}
        </div>
      )}
      {solving && (
        <div className="solve-note">solving… {useCubeStore.getState().turnBatches[0]?.tokens.length ?? 0} turns left</div>
      )}
      {showRestoreNote && !solving && (
        <div className="restored-note">picked up where you left off</div>
      )}
      {!sessionRestored && !solved && !showTimer && (
        <div className="hint">drag a row or column to twist · space to scramble</div>
      )}
    </div>
  );
}

function busyFromStore(s: { busy: 'idle' | 'turning'; turnBatches: { label: string }[] }): boolean {
  return s.busy === 'turning' && s.turnBatches[0]?.label === 'solve';
}
