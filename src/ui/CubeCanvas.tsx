/**
 * CubeCanvas — owns the Three.js world: SceneManager + CubeView +
 * TurnAnimator + TwistGesture, wired to the store. The scene re-derives from
 * core state on every version bump; animators and the gesture are the only
 * transient-visual writers.
 */

import { useEffect, useRef } from 'react';
import { SceneManager } from '../three/SceneManager';
import { buildCubeView, syncScene, reconcileTiles } from '../three/CubeView';
import { TurnAnimator } from '../three/TurnAnimator';
import { TwistGesture } from '../three/TwistGesture';
import { useCubeStore } from '../store/useCubeStore';
import { registerRenderer } from '../three/viewExport';
import { on } from '../utils/bus';

export function CubeCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SceneManager(container);
    registerRenderer(scene.renderer);
    const handles = buildCubeView(useCubeStore.getState().session.cube);
    scene.scene.add(handles.group);
    if (import.meta.env.DEV) {
      // deterministic pixel probes for E2E (dev builds only)
      (window as unknown as { __twistdraw?: unknown }).__twistdraw = { handles, scene, store: useCubeStore };
    }

    const animator = new TurnAnimator(handles);
    const gesture = new TwistGesture(scene, handles);

    scene.onUpdate((dt) => {
      animator.update(dt);
    });

    const unsub = useCubeStore.subscribe((state, prev) => {
      if (state.version !== prev.version) {
        syncScene(handles, state.session.cube);
        reconcileTiles(handles, state.session.tiles);
      }
    });

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // view-rotation buttons (never interfere with twist gestures)
    const unOrbit = on('camera-orbit', ({ dTheta, dPhi }) => scene.orbitBy(dTheta, dPhi));
    const unReset = on('camera-reset', () => scene.resetView());

    return () => {
      unsub();
      unOrbit();
      unReset();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      gesture.dispose();
      scene.dispose();
    };
  }, []);

  return <div className="cube-canvas" ref={containerRef} />;
}
