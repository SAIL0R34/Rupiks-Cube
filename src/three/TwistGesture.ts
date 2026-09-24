/**
 * TwistGesture — direct-manipulation layer twisting.
 *
 * Pointerdown raycasts the sticker planes. A hit starts a twist gesture
 * (orbit disabled for its duration); the initial dominant screen-space drag
 * direction locks the layer: dragging along a face's u axis twists the row
 * about the v axis, and vice versa — including middle rows (M/E/S). The layer
 * follows the finger via a live preview pivot; release past the threshold
 * commits the quarter turns through the normal turn pipeline, otherwise it
 * snaps back. A miss falls through to orbit.
 *
 * Sign math: the hit point P moves under rotation about axis a with velocity
 * a×P; the commit sign is chosen so the layer follows the finger.
 */

import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { CubeViewHandles } from './CubeView';
import { syncScene } from './CubeView';
import { FACE_FRAME, faceOfNormal } from '../core/faces';
import type { Face } from '../core/faces';
import type { Axis } from '../core/moves';
import { MOVE_TABLE, tokenFor } from '../core/moves';
import type { MoveToken } from '../core/moves';
import { useCubeStore } from '../store/useCubeStore';

const LOCK_PX = 7; // drag distance before the axis locks
const PX_PER_90 = 130; // drag distance for a quarter turn
const MAX_ANGLE = (135 * Math.PI) / 180;

interface Gesture {
  hitPoint: THREE.Vector3;
  face: Face;
  /** the two in-plane world axes of the hit face */
  u: THREE.Vector3;
  v: THREE.Vector3;
  start: { x: number; y: number };
  locked: null | { axis: THREE.Vector3; axisName: Axis; coord: -1 | 0 | 1; screenDir: THREE.Vector2 };
  layerMeshes: THREE.Mesh[];
}

export class TwistGesture {
  private scene: SceneManager;
  private handles: CubeViewHandles;
  private pivot: THREE.Group;
  private g: Gesture | null = null;
  private ndc = new THREE.Vector2();

  constructor(scene: SceneManager, handles: CubeViewHandles) {
    this.scene = scene;
    this.handles = handles;
    this.pivot = new THREE.Group();
    handles.group.add(this.pivot);

    // capture-phase on the container so we win over OrbitControls on hits
    const el = scene.renderer.domElement.parentElement!;
    el.addEventListener('pointerdown', this.onDown as EventListener, true);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  dispose(): void {
    const el = this.scene.renderer.domElement.parentElement;
    el?.removeEventListener('pointerdown', this.onDown as EventListener, true);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  private setNdc(e: PointerEvent): void {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (useCubeStore.getState().busy !== 'idle') return;
    this.setNdc(e);
    this.scene.raycaster.setFromCamera(this.ndc, this.scene.camera);
    const planes = [...this.handles.stickerPlanes.values()];
    const hits = this.scene.raycaster.intersectObjects(planes, false);
    if (hits.length === 0) return; // miss → orbit handles it

    const hit = hits[0];
    const stickerId = hit.object.userData.stickerId as number;
    const state = useCubeStore.getState().session.cube;
    let cubiePos: readonly number[] | null = null;
    let worldN: readonly number[] | null = null;
    for (const c of state.cubies) {
      for (const s of c.stickers) {
        if (s.id !== stickerId) continue;
        cubiePos = c.pos;
        const R = c.R;
        const ln = s.localNormal;
        worldN = [
          R[0] * ln[0] + R[1] * ln[1] + R[2] * ln[2],
          R[3] * ln[0] + R[4] * ln[1] + R[5] * ln[2],
          R[6] * ln[0] + R[7] * ln[1] + R[8] * ln[2],
        ];
      }
    }
    if (!cubiePos || !worldN) return;

    const face = faceOfNormal([worldN[0], worldN[1], worldN[2]] as [number, number, number]);
    const frame = FACE_FRAME[face];
    this.g = {
      hitPoint: hit.point.clone(),
      face,
      u: new THREE.Vector3(frame.uAxis[0], frame.uAxis[1], frame.uAxis[2]),
      v: new THREE.Vector3(frame.vAxis[0], frame.vAxis[1], frame.vAxis[2]),
      start: { x: e.clientX, y: e.clientY },
      locked: null,
      layerMeshes: [],
    };
    this.scene.controls.enabled = false; // this drag is a twist, not an orbit
    this.scene.renderer.domElement.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
  };

  private onMove = (e: PointerEvent) => {
    const g = this.g;
    if (!g) return;
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    this.currentDrag.set(dx, dy);

    if (!g.locked) {
      if (Math.hypot(dx, dy) < LOCK_PX) return;
      const projU = this.screenDir(g.u);
      const projV = this.screenDir(g.v);
      const drag = new THREE.Vector2(dx, dy);
      const alongU = Math.abs(drag.dot(projU));
      const alongV = Math.abs(drag.dot(projV));
      // dragging along u twists about v (the row), and vice versa
      const twistAxisVec = alongU >= alongV ? g.v : g.u;
      const dragAxisVec = alongU >= alongV ? g.u : g.v;
      const axisName: Axis = dominantAxis(twistAxisVec);
      const coord = coordAlong(g.hitPoint, axisName) as -1 | 0 | 1;
      // sign so the layer follows the finger: velocity of P under +θ is a×P
      const omega = new THREE.Vector3().crossVectors(twistAxisVec, g.hitPoint);
      const follow = Math.sign(omega.dot(dragAxisVec)) || 1;
      const screenDir = this.screenDir(dragAxisVec).multiplyScalar(follow);
      g.locked = { axis: twistAxisVec, axisName, coord, screenDir };
      // collect the layer's meshes into the preview pivot
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.updateMatrixWorld(true);
      const idx = axisName === 'x' ? 0 : axisName === 'y' ? 1 : 2;
      for (const cubie of useCubeStore.getState().session.cube.cubies) {
        if (cubie.pos[idx] !== coord) continue;
        const mesh = this.handles.cubieMeshes.get(cubie.id);
        if (mesh) this.pivot.attach(mesh);
      }
    }

    const locked = g.locked!;
    const drag = new THREE.Vector2(dx, dy);
    const mag = drag.dot(locked.screenDir) / PX_PER_90; // in quarter units, signed
    const angle = THREE.MathUtils.clamp(mag * (Math.PI / 2), -MAX_ANGLE, MAX_ANGLE);
    this.pivot.setRotationFromAxisAngle(locked.axis, angle);
  };

  private onUp = () => {
    const g = this.g;
    if (!g) return;
    this.g = null;
    this.scene.controls.enabled = true;
    this.scene.renderer.domElement.style.cursor = '';
    const locked = g.locked;

    // release meshes back to the group at their preview pose, then snap exact
    this.pivot.updateMatrixWorld(true);
    for (const mesh of [...this.pivot.children]) {
      this.handles.group.attach(mesh);
    }
    this.pivot.rotation.set(0, 0, 0);
    syncScene(this.handles, useCubeStore.getState().session.cube);

    if (!locked) return;
    // preview angle → committed quarter turns
    const quartersF = this.currentDrag.dot(locked.screenDir) / PX_PER_90;
    const k = Math.round(quartersF); // signed quarter count about +axis
    if (k === 0) return; // snap back
    const cwSign = cwSignFor(locked.axisName, locked.coord);
    const cwQuarters = ((k * cwSign) % 4 + 4) % 4; // 0..3 as CW quarters
    if (cwQuarters === 0) return;
    let token: MoveToken;
    try {
      token = tokenFor(locked.axisName, locked.coord, cwQuarters as 1 | 2 | 3);
    } catch {
      return;
    }
    useCubeStore.getState().enqueueTurns([token], { label: 'twist', fast: true });
  };

  private currentDrag = new THREE.Vector2();

  /** world direction → normalized screen-space direction at the hit point */
  private screenDir(worldDir: THREE.Vector3): THREE.Vector2 {
    const camera = this.scene.camera;
    const p0 = this.g!.hitPoint.clone().project(camera);
    const p1 = this.g!.hitPoint.clone().add(worldDir.clone().multiplyScalar(0.5)).project(camera);
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const d = new THREE.Vector2(
      (p1.x - p0.x) * (rect.width / 2),
      -(p1.y - p0.y) * (rect.height / 2),
    );
    const len = d.length();
    return len > 1e-6 ? d.divideScalar(len) : d;
  }
}

function dominantAxis(v: THREE.Vector3): Axis {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  return ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
}

/** hit point → layer coordinate (cubie centers sit on integers) */
function coordAlong(p: THREE.Vector3, axis: Axis): number {
  const v = axis === 'x' ? p.x : axis === 'y' ? p.y : p.z;
  return Math.max(-1, Math.min(1, Math.round(v)));
}

/** cwSign for a specific axis+coord, straight from the move table */
function cwSignFor(axis: Axis, coord: -1 | 0 | 1): 1 | -1 {
  const def = Object.values(MOVE_TABLE).find((d) => d.axis === axis && d.coord === coord);
  if (!def) throw new Error(`no move for ${axis}${coord}`);
  return def.cwSign;
}
