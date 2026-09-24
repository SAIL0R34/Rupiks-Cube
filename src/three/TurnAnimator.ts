/**
 * TurnAnimator — animates layer turns in the scene graph without ever owning
 * authoritative state.
 *
 * Per token: a temporary pivot group is oriented to the move's world axis;
 * the 9 affected cubie meshes are reparented into it (world transforms
 * preserved); the pivot tweens 0 → target angle; on completion the store
 * commits the move to core state and meshes snap back to exact
 * integer-derived transforms via syncScene. The tween is pure spectacle.
 *
 * CW convention: a CW quarter turn of a face is −90° about its outward
 * normal, so plain = −90°, prime = +90°, double = 180° (sign-equivalent).
 */

import * as THREE from 'three';
import type { CubeViewHandles } from './CubeView';
import { syncScene } from './CubeView';
import { FACE_FRAME } from '../core/faces';
import type { Face } from '../core/faces';
import type { MoveToken } from '../core/moves';
import { MOVE_TABLE } from '../core/moves';
import { useCubeStore } from '../store/useCubeStore';
import { dot } from '../core/faces';

const USER_TURN_MS = 220;
const FAST_TURN_MS = 90;

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class TurnAnimator {
  private handles: CubeViewHandles;
  private pivot: THREE.Group;
  private active = false;
  private elapsed = 0;
  private duration = USER_TURN_MS;
  private axis = new THREE.Vector3();
  private targetAngle = 0;
  private currentToken: MoveToken | null = null;
  private currentLog = true;

  constructor(handles: CubeViewHandles) {
    this.handles = handles;
    this.pivot = new THREE.Group();
    this.handles.group.add(this.pivot);
  }

  /** called every frame from SceneManager */
  update(dt: number): void {
    const store = useCubeStore.getState();
    if (!this.active) {
      if (store.busy === 'turning' && store.turnBatches.length > 0) {
        this.beginNext();
      }
      return;
    }
    this.elapsed += dt * 1000;
    const t = Math.min(1, this.elapsed / this.duration);
    this.pivot.setRotationFromAxisAngle(this.axis, this.targetAngle * easeInOutQuad(t));
    if (t >= 1) {
      this.commit();
    }
  }

  private beginNext(): void {
    const store = useCubeStore.getState();
    const batch = store.turnBatches[0];
    const token = batch.tokens[0];
    // If the batch is long, skip-to-end for all but the last couple of tokens
    if (batch.tokens.length > 4 && batch.tokens.indexOf(token) < batch.tokens.length - 2) {
      this.commitInstant(batch, token);
      return;
    }
    this.startTween(batch, token);
  }

  private startTween(batch: ReturnType<typeof useCubeStore.getState>['turnBatches'][0], token: MoveToken): void {
    const def = MOVE_TABLE[token];
    const n = FACE_FRAME[def.face].n;
    this.axis.set(n[0], n[1], n[2]);
    const quarter = token.endsWith("'") ? 3 : token.endsWith('2') ? 2 : 1;
    // CW quarter turns about the outward normal = negative angle
    const angle = -quarter * (Math.PI / 2);
    this.targetAngle = angle;
    this.duration = batch.fast ? FAST_TURN_MS : USER_TURN_MS;
    this.elapsed = 0;
    this.currentToken = token;
    this.currentLog = batch.log;
    this.active = true;

    // reparent affected cubie meshes into the pivot
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.updateMatrixWorld(true);
    const state = useCubeStore.getState().session.cube;
    for (const cubie of state.cubies) {
      if (dot(cubie.pos, n) !== 1) continue;
      const mesh = this.handles.cubieMeshes.get(cubie.id);
      if (mesh) this.pivot.attach(mesh);
    }
    useCubeStore.getState().markAnimating(true);
  }

  private commit(): void {
    const token = this.currentToken!;
    this.active = false;
    this.currentToken = null;
    const store = useCubeStore.getState();
    // commit core state FIRST, then snap meshes out of the pivot
    store.commitMove(token, this.currentLog);
    this.releasePivot();
    useCubeStore.getState().markAnimating(false);
    this.advanceBatch();
  }

  /** skip animation entirely (long scramble/solve batches) */
  private commitInstant(batch: ReturnType<typeof useCubeStore.getState>['turnBatches'][0], token: MoveToken): void {
    useCubeStore.getState().commitMove(token, batch.log);
    this.advanceBatch();
  }

  private releasePivot(): void {
    // detach meshes FIRST (attach preserves world transforms at the tween's
    // final pose), then reset the pivot — no visual snap-back
    this.pivot.updateMatrixWorld(true);
    for (const mesh of [...this.pivot.children]) {
      this.handles.group.attach(mesh);
    }
    this.pivot.rotation.set(0, 0, 0);
    // snap every mesh to exact integer-derived transforms (kills tween fuzz)
    syncScene(this.handles, useCubeStore.getState().session.cube);
  }

  private advanceBatch(): void {
    const store = useCubeStore.getState();
    const batch = store.turnBatches[0];
    const rest = batch.tokens.slice(1);
    if (rest.length > 0) {
      // mutate the head batch in place (store treats turnBatches as transient)
      (batch as { tokens: MoveToken[] }).tokens = rest;
      if (!this.active) {
        // continue on next frame
        return;
      }
    } else {
      useCubeStore.getState().finishBatch();
      // snap everything to exact transforms after each batch
      syncScene(this.handles, useCubeStore.getState().session.cube);
    }
  }
}

/** convenience for tests/dev: which face does this token turn */
export function tokenFace(token: MoveToken): Face {
  return MOVE_TABLE[token].face;
}
