import { useEffect, useState } from 'react';
import { CubeCanvas } from './ui/CubeCanvas';
import { useKeyboard } from './ui/useKeyboard';
import { Onboarding } from './ui/Onboarding';
import { ControlPanel } from './ui/ControlPanel';
import { StatusBar } from './ui/StatusBar';
import { burstConfetti } from './ui/confetti';
import { useCubeStore, hasAllImages } from './store/useCubeStore';
import { on } from './utils/bus';

export default function App(): JSX.Element {
  useKeyboard();
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    const un = on('celebrate', () => {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1700);
      burstConfetti();
    });
    return un;
  }, []);

  const started = useCubeStore((s) => hasAllImages(s.session));

  return (
    <div className="app">
      {celebrate && <div className="celebrate-glow" />}
      <CubeCanvas />
      {!started && <Onboarding />}
      <StatusBar />
      <ControlPanel />
    </div>
  );
}
