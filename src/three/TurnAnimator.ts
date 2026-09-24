/**
 * TurnAnimator — animates layer turns in the scene graph without ever owning
 * authoritative state.
 *
 * Per token: a temporary pivot group is oriented to the move's world axis;
 * the affected cubie meshes are reparented into it (world transforms
 * preserved); the pivot tweens 0 → target angle; on completion the store
 * commits the move to core state and meshes snap back to exact
 * integer-derived transforms via syncScene. The tween is pure spectacle.
 *
 * Angles: a move's CW quarter turn is `cwSign·90°` about `+axis` (MoveDef),
 * so plain CW = cwSign·90°, prime = −cwSign·90°, double = 180°.
 */

import * as THREE from 'three';
import type { CubeViewHandles } from './CubeView';
import { syncScene } from './CubeView';
import type { MoveToken } from '../core/moves';
import { MOVE_TABLE } from '../core/moves';
import { useCubeStore } from '../store/useCubeStore';

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
    // long batches: skip-to-end for all but the last couple of tokens
    if (batch.tokens.length > 4 && batch.tokens.indexOf(token) < batch.tokens.length - 2) {
      useCubeStore.getState().commitMove(token, batch.log);
      this.advanceBatch();
      return;
    }
    this.startTween(batch, token);
  }

  private startTween(
    batch: ReturnType<typeof useCubeStore.getState>['turnBatches'][0],
    token: MoveToken,
  ): void {
    const def = MOVE_TABLE[token];
    const unit = def.axis === 'x' ? [1, 0, 0] : def.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    this.axis.set(unit[0], unit[1], unit[2]);
    const quarter = token.endsWith("'") ? 3 : token.endsWith('2') ? 2 : 1;
    // CW quarter = cwSign·90°; prime = one CCW = −cwSign·90°; double = 180°
    const angle =
      quarter === 2
        ? Math.PI
        : (quarter === 1 ? 1 : -1) * def.cwSign * (Math.PI / 2);
    this.targetAngle = angle;
    this.duration = batch.fast ? FAST_TURN_MS : USER_TURN_MS;
    this.elapsed = 0;
    this.currentToken = token;
    this.currentLog = batch.log;
    this.active = true;

    this.pivot.rotation.set(0, 0, 0);
    this.pivot.updateMatrixWorld(true);
    const state = useCubeStore.getState().session.cube;
    const axisIdx = def.axis === 'x' ? 0 : def.axis === 'y' ? 1 : 2;
    for (const cubie of state.cubies) {
      if (cubie.pos[axisIdx] !== def.coord) continue;
      const mesh = this.handles.cubieMeshes.get(cubie.id);
      if (mesh) this.pivot.attach(mesh);
    }
    useCubeStore.getState().markAnimating(true);
  }

  private commit(): void {
    const token = this.currentToken!;
    this.active = false;
    this.currentToken = null;
    useCubeStore.getState().commitMove(token, this.currentLog);
    this.releasePivot();
    useCubeStore.getState().markAnimating(false);
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
    syncScene(this.handles, useCubeStore.getState().session.cube);
  }

  private advanceBatch(): void {
    const store = useCubeStore.getState();
    const batch = store.turnBatches[0];
    const rest = batch.tokens.slice(1);
    if (rest.length > 0) {
      (batch as { tokens: MoveToken[] }).tokens = rest;
    } else {
      useCubeStore.getState().finishBatch();
      syncScene(this.handles, useCubeStore.getState().session.cube);
    }
  }
}
