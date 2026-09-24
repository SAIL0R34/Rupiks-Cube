/**
 * CursorView — the plotting/drawing crosshair on the active face.
 * Position comes from face coords (u,v) via the core facePoint math; the
 * cursor is a VIEW of state, never a source of truth.
 */

import * as THREE from 'three';
import { FACE_FRAME, facePoint } from '../core/faces';
import type { Face } from '../core/faces';

const CURSOR_FLOAT = 0.035; // above the sticker plane

export class CursorView {
  readonly group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    const mat = new THREE.MeshBasicMaterial({ color: 0xd8483b, transparent: true, opacity: 0.9 });
    const barGeoX = new THREE.BoxGeometry(0.34, 0.012, 0.004);
    const barGeoY = new THREE.BoxGeometry(0.012, 0.34, 0.004);
    const ringGeo = new THREE.RingGeometry(0.05, 0.075, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd8483b, transparent: true, opacity: 0.7, side: THREE.DoubleSide });

    const barH = new THREE.Mesh(barGeoX, mat);
    const barV = new THREE.Mesh(barGeoY, mat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    this.group.add(barH, barV, ring);
  }

  /** place the cursor at face coords (u,v) on `face` */
  update(face: Face, u: number, v: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    const frame = FACE_FRAME[face];
    const p = facePoint(face, u, v);
    const n = frame.n;
    this.group.position.set(
      p[0] + n[0] * CURSOR_FLOAT,
      p[1] + n[1] * CURSOR_FLOAT,
      p[2] + n[2] * CURSOR_FLOAT,
    );
    const uAxis = new THREE.Vector3(frame.uAxis[0], frame.uAxis[1], frame.uAxis[2]);
    const vAxis = new THREE.Vector3(frame.vAxis[0], frame.vAxis[1], frame.vAxis[2]);
    const normal = new THREE.Vector3(n[0], n[1], n[2]);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(uAxis, vAxis, normal));
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}
