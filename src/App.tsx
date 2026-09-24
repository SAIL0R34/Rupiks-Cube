import { CubeCanvas } from './ui/CubeCanvas';
import { useKeyboard } from './ui/useKeyboard';
import { useCubeStore } from './store/useCubeStore';
import { movesSinceReference, matchesReference } from './core/history';

export default function App(): JSX.Element {
  useKeyboard();
  const mode = useCubeStore((s) => s.mode);
  const penDown = useCubeStore((s) => s.penDown);
  const activeFace = useCubeStore((s) => s.activeFace);
  const turnFace = useCubeStore((s) => s.turnFace);
  const busy = useCubeStore((s) => s.busy);
  const banner = useCubeStore((s) => s.banner);
  const logLen = useCubeStore((s) => s.session.log.length);
  const pending = useCubeStore((s) => {
    const sess = s.session;
    return sess.reference ? Math.max(0, sess.log.length - sess.reference.logLength) : 0;
  });
  const solved = useCubeStore((s) =>
    s.session.reference ? matchesReference(s.session.cube, s.session.reference) : false,
  );
  void movesSinceReference;
  void logLen;

  return (
    <div className="app">
      <CubeCanvas />
      <div className="hud">
        {banner && <div className="banner">{banner.text}</div>}
        <div className="status">
          <span className={`chip ${busy !== 'idle' ? 'busy' : ''}`}>
            {busy === 'idle' ? 'ready' : busy}
          </span>
          <span className="chip">draw: {activeFace}</span>
          <span className="chip">turn: {turnFace}</span>
          {mode !== 'idle' && (
            <span className={`chip mode-${mode}`}>
              {mode}
              {penDown ? ' · pen down' : ''}
            </span>
          )}
          {pending > 0 && <span className="chip">{pending} from reference</span>}
          {solved && <span className="chip solved">SOLVED</span>}
        </div>
      </div>
    </div>
  );
}
