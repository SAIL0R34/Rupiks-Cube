/**
 * CubeCanvas — owns the Three.js world: SceneManager + CubeView + CursorView
 * + TurnAnimator, wired to the store. The scene re-derives from core state on
 * every version bump; animators are the only transient-visual writers.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SceneManager } from '../three/SceneManager';
import { buildCubeView, syncScene } from '../three/CubeView';
import type { CubeViewHandles } from '../three/CubeView';
import { CursorView } from '../three/CursorView';
import { TurnAnimator } from '../three/TurnAnimator';
import { useCubeStore } from '../store/useCubeStore';
import { stampDevMarkers } from '../three/devMarkers';
import { on } from '../utils/bus';
import type { Face } from '../core/faces';
import { FACE_FRAME, facePoint } from '../core/faces';

export function CubeCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SceneManager(container);
    const handles = buildCubeView(useCubeStore.getState().session.cube);
    scene.scene.add(handles.group);

    const cursor = new CursorView();
    scene.scene.add(cursor.group);

    const animator = new TurnAnimator(handles);
    scene.onUpdate((dt) => {
      animator.update(dt);
      const s = useCubeStore.getState();
      cursor.update(s.activeFace, s.cursor.u, s.cursor.v, s.cursor.visible);
    });

    // dev orientation markers
    if (new URLSearchParams(window.location.search).has('debug')) {
      stampDevMarkers(useCubeStore.getState().session.cube, handles);
    }

    // re-derive the scene whenever core state changes (commits, undo, hydrate)
    const unsub = useCubeStore.subscribe((state, prev) => {
      if (state.version !== prev.version) {
        syncScene(handles, state.session.cube);
      }
    });

    // face-highlight frame for the active drawing face
    const highlight = new THREE.Mesh(
      new THREE.BoxGeometry(3.06, 3.06, 3.06),
      new THREE.MeshBasicMaterial({ color: 0xd8483b, wireframe: true, transparent: true, opacity: 0.0 }),
    );
    scene.scene.add(highlight);

    const lookAtFace = (face: Face) => {
      const frame = FACE_FRAME[face];
      const p = facePoint(face, 1.5, 1.5);
      const dist = 8.2;
      const target = new THREE.Vector3(p[0] * 1.6, p[1] * 1.6, p[2] * 1.6).setLength(dist);
      // tween camera position toward the face-normal viewpoint
      const start = scene.camera.position.clone();
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 450);
        const eased = 1 - Math.pow(1 - t, 3);
        scene.camera.position.lerpVectors(start, target, eased);
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    };
    const unlook = on('camera-look', ({ face }) => lookAtFace(face));

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      unsub();
      unlook();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      cursor.dispose();
      scene.dispose();
    };
  }, []);

  return <div className="cube-canvas" ref={containerRef} />;
}
