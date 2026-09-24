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
import { registerRenderer } from '../three/viewExport';
import { tickPlot } from '../plotting/PlotSession';
import { on } from '../utils/bus';
import type { Face } from '../core/faces';
import { FACE_FRAME, facePoint } from '../core/faces';

export function CubeCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SceneManager(container);
    registerRenderer(scene.renderer);
    const handles = buildCubeView(useCubeStore.getState().session.cube);
    scene.scene.add(handles.group);

    const cursor = new CursorView();
    scene.scene.add(cursor.group);

    const animator = new TurnAnimator(handles);
    scene.onUpdate((dt) => {
      animator.update(dt);
      tickPlot(dt, handles);
      const s = useCubeStore.getState();
      cursor.update(s.activeFace, s.cursor.u, s.cursor.v, s.cursor.visible);
      // active-face frame follows the drawing face; visible when cursor is
      const frame = FACE_FRAME[s.activeFace];
      const n = frame.n;
      highlight.position.set(n[0] * 1.62, n[1] * 1.62, n[2] * 1.62);
      const uA = new THREE.Vector3(frame.uAxis[0], frame.uAxis[1], frame.uAxis[2]);
      const vA = new THREE.Vector3(frame.vAxis[0], frame.vAxis[1], frame.vAxis[2]);
      const nV = new THREE.Vector3(n[0], n[1], n[2]);
      highlight.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(uA, vA, nV));
      const mat = highlight.material as THREE.MeshBasicMaterial;
      const pulse = 0.22 + 0.1 * Math.sin(performance.now() / 300);
      mat.opacity = s.cursor.visible ? pulse : 0;
    });

    // dev orientation markers
    if (new URLSearchParams(window.location.search).has('debug')) {
      stampDevMarkers(useCubeStore.getState().session.cube, handles);
    }

    // re-derive the scene whenever core state changes (commits, undo, hydrate)
    const strokeSigs = new Map<number, string>();
    const reconcileStrokes = (cube: import('../core/cubeState').CubeState) => {
      for (const cubie of cube.cubies) {
        for (const sticker of cubie.stickers) {
          const sig = `${sticker.strokes.length}:${sticker.strokes[sticker.strokes.length - 1]?.id ?? -1}`;
          if (strokeSigs.get(sticker.id) !== sig) {
            strokeSigs.set(sticker.id, sig);
            handles.stickerTextures.get(sticker.id)?.redrawAll(sticker.strokes);
          }
        }
      }
    };
    const unsub = useCubeStore.subscribe((state, prev) => {
      if (state.version !== prev.version) {
        syncScene(handles, state.session.cube);
        reconcileStrokes(state.session.cube);
      }
    });

    // active drawing-face highlight: a thin frame floating just off the face
    const highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(3.14, 3.14),
      new THREE.MeshBasicMaterial({
        color: 0xd8483b,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        wireframe: true,
      }),
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
