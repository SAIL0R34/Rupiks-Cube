/**
 * CubeView — the 3D cube: 26 cubie meshes + 54 sticker planes.
 *
 * Every sticker plane is created ONCE in cubie-local space and parented to its
 * cubie mesh; its local transform never changes. Cubie meshes get their world
 * transform from the core state (position + orientation matrix). Layer turns
 * animate via a temporary pivot group (TurnAnimator / TwistGesture) and the
 * commit snaps meshes back to exact integer-derived transforms — the scene is
 * always re-derivable from core state (syncScene).
 */

import * as THREE from 'three';
import type { CubeState } from '../core/cubeState';
import { FACE_FRAME, faceOfNormal } from '../core/faces';
import type { Face } from '../core/faces';
import type { Mat3, Vec3 } from '../core/rotation';
import type { Sticker } from '../core/stickers';
import { StickerTexture } from './StickerTexture';

const CUBIE_SIZE = 1;
const STICKER_OFFSET = 0.512; // half cubie + small gap so art floats above seams
const CUBIE_COLOR = 0x26221d; // warm near-black, sits in the cream scene

export interface CubeViewHandles {
  group: THREE.Group;
  cubieMeshes: Map<number, THREE.Mesh>;
  stickerTextures: Map<number, StickerTexture>;
  stickerPlanes: Map<number, THREE.Mesh>;
  bodyGeometry: THREE.BoxGeometry;
  planeGeometry: THREE.PlaneGeometry;
}

export function buildCubeView(state: CubeState): CubeViewHandles {
  const group = new THREE.Group();
  const cubieMeshes = new Map<number, THREE.Mesh>();
  const stickerTextures = new Map<number, StickerTexture>();
  const stickerPlanes = new Map<number, THREE.Mesh>();

  const bodyGeometry = new THREE.BoxGeometry(CUBIE_SIZE * 0.985, CUBIE_SIZE * 0.985, CUBIE_SIZE * 0.985);
  const planeGeometry = new THREE.PlaneGeometry(CUBIE_SIZE * 0.99, CUBIE_SIZE * 0.99);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: CUBIE_COLOR,
    roughness: 0.42,
    metalness: 0.06,
  });

  for (const cubie of state.cubies) {
    const mesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    mesh.userData.cubieId = cubie.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    cubieMeshes.set(cubie.id, mesh);

    for (const sticker of cubie.stickers) {
      const tex = new StickerTexture();
      stickerTextures.set(sticker.id, tex);
      const plane = new THREE.Mesh(
        planeGeometry,
        new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.68, metalness: 0 }),
      );
      plane.receiveShadow = true;
      placeStickerPlane(plane, sticker);
      mesh.add(plane);
      stickerPlanes.set(sticker.id, plane);
    }
  }

  const handles: CubeViewHandles = {
    group,
    cubieMeshes,
    stickerTextures,
    stickerPlanes,
    bodyGeometry,
    planeGeometry,
  };
  syncScene(handles, state);
  return handles;
}

/**
 * Place a sticker plane in its cubie's LOCAL frame from the sticker's
 * localNormal, using the SAME FACE_FRAME table the math uses. Plane +X → su,
 * +Y → sv, +Z → localNormal; canvas y-flip matches (see StickerTexture).
 */
function placeStickerPlane(plane: THREE.Mesh, sticker: Sticker): void {
  const face: Face = faceOfNormal(sticker.localNormal as Vec3);
  const frame = FACE_FRAME[face];
  const n = new THREE.Vector3(frame.n[0], frame.n[1], frame.n[2]);
  const u = new THREE.Vector3(frame.uAxis[0], frame.uAxis[1], frame.uAxis[2]);
  const v = new THREE.Vector3(frame.vAxis[0], frame.vAxis[1], frame.vAxis[2]);
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
  plane.position.set(n.x * STICKER_OFFSET, n.y * STICKER_OFFSET, n.z * STICKER_OFFSET);
  plane.userData.stickerId = sticker.id;
}

/**
 * Re-derive all cubie mesh transforms (position + orientation) from core
 * state. Called after every commit; the scene never holds authoritative state.
 */
export function syncScene(handles: CubeViewHandles, state: CubeState): void {
  for (const cubie of state.cubies) {
    const mesh = handles.cubieMeshes.get(cubie.id);
    if (!mesh) continue;
    mesh.position.set(cubie.pos[0], cubie.pos[1], cubie.pos[2]);
    mesh.quaternion.setFromRotationMatrix(mat4FromMat3(cubie.R));
    mesh.updateMatrix();
  }
}

/** row-major Mat3 → THREE.Matrix4 (.set takes row-major elements) */
export function mat4FromMat3(r: Mat3): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    r[0], r[1], r[2], 0,
    r[3], r[4], r[5], 0,
    r[6], r[7], r[8], 0,
    0, 0, 0, 1,
  );
}

/**
 * Push session tile content into the textures. Cheap: each texture no-ops
 * unless its dataURL changed.
 */
export function reconcileTiles(
  handles: CubeViewHandles,
  tiles: ReadonlyMap<number, string | null>,
): void {
  for (const [stickerId, tex] of handles.stickerTextures) {
    tex.setImage(tiles.get(stickerId) ?? null);
  }
}

export function disposeCubeView(handles: CubeViewHandles): void {
  for (const t of handles.stickerTextures.values()) t.dispose();
  for (const p of handles.stickerPlanes.values()) {
    (p.material as THREE.Material).dispose();
  }
  handles.bodyGeometry.dispose();
  handles.planeGeometry.dispose();
}
