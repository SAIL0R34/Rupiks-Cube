/** StatusBar — banner, solve progress, restored note, first-time hint */

import { useEffect, useState } from 'react';
import { useCubeStore, hasAllImages } from '../store/useCubeStore';
import { matchesReference } from '../core/history';

const RESTORE_NOTE_MS = 4500;

export function StatusBar(): JSX.Element | null {
  const banner = useCubeStore((s) => s.banner);
  const clearBanner = useCubeStore((s) => s.clearBanner);
  const busy = useCubeStore((s) => s.busy);
  const sessionRestored = useCubeStore((s) => s.sessionRestored);
  const solving = useCubeStore((s) => busyFromStore(s));
  const started = useCubeStore((s) => hasAllImages(s.session));
  const solved = useCubeStore((s) =>
    s.session.reference ? matchesReference(s.session, s.session.reference) : false,
  );
  // the restore note is transient: a few seconds after a genuine pickup, then gone
  const [showRestoreNote, setShowRestoreNote] = useState(false);

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

  return (
    <div className="status-bar">
      {banner && <div className="banner" key={banner.at}>{banner.text}</div>}
      {solving && (
        <div className="solve-note">solving… {useCubeStore.getState().turnBatches[0]?.tokens.length ?? 0} turns left</div>
      )}
      {showRestoreNote && !solving && (
        <div className="restored-note">picked up where you left off</div>
      )}
      {!sessionRestored && !solved && (
        <div className="hint">drag a row or column to twist · space to scramble</div>
      )}
    </div>
  );
}

function busyFromStore(s: { busy: 'idle' | 'turning'; turnBatches: { label: string }[] }): boolean {
  return s.busy === 'turning' && s.turnBatches[0]?.label === 'solve';
}
