import { useEffect, useRef } from 'react';
import { CubeCanvas } from './ui/CubeCanvas';
import { useKeyboard } from './ui/useKeyboard';
import { KnobDeck } from './ui/KnobDeck';
import { ControlPanel } from './ui/ControlPanel';
import { StatusBar } from './ui/StatusBar';
import { HelpOverlay } from './ui/HelpOverlay';
import { useCubeStore } from './store/useCubeStore';
import { matchesReference } from './core/history';
import { uploadAndSketch } from './plotting/uploadFlow';
import { abortPlot } from './plotting/PlotSession';
import { on } from './utils/bus';

export default function App(): JSX.Element {
  useKeyboard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unUpload = on('upload-request', () => fileInputRef.current?.click());
    const unAbort = on('abort-plot', () => abortPlot());
    return () => {
      unUpload();
      unAbort();
    };
  }, []);

  const mode = useCubeStore((s) => s.mode);
  const penDown = useCubeStore((s) => s.penDown);
  const activeFace = useCubeStore((s) => s.activeFace);
  const turnFace = useCubeStore((s) => s.turnFace);
  const busy = useCubeStore((s) => s.busy);
  const banner = useCubeStore((s) => s.banner);
  const logLen = useCubeStore((s) => s.session.log.length);
  void logLen;
  const pending = useCubeStore((s) => {
    const sess = s.session;
    return sess.reference ? Math.max(0, sess.log.length - sess.reference.logLength) : 0;
  });
  const solved = useCubeStore((s) =>
    s.session.reference ? matchesReference(s.session.cube, s.session.reference) : false,
  );
  void logLen;

  return (
    <div className="app">
      <CubeCanvas />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadAndSketch(file);
          e.target.value = '';
        }}
      />
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
        <div className="bottom-bar">
          <StatusBar />
          <KnobDeck />
          <ControlPanel />
        </div>
      </div>
      <HelpOverlay />
    </div>
  );
}
