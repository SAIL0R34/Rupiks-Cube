/**
 * FACE_FRAME — the single source of truth for every 2D coordinate decision in
 * the app. Both the core math (transform.ts) and the renderer (CubeView /
 * StickerTexture) read THIS table; duplicating it anywhere else is how mirrored
 * artwork bugs are born.
 *
 * For each face: outward world normal `n`, in-plane axes `u` (right) and `v`
 * (up) such that facing the face head-on at the canonical viewing angle, u
 * points right and v points up, and u × v = n (right-handed).
 *
 * Face space: (u,v) ∈ [0,3]², cell (i,j) = (floor(u), floor(v)) ∈ [0,2]².
 * The cube spans [−1.5, 1.5]³; each cubie spans 1 unit centered on integer
 * coordinates in {−1,0,1}.
 */

import type { Vec3 } from './rotation';

export type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

export interface FaceFrame {
  readonly face: Face;
  /** outward world normal */
  readonly n: Vec3;
  /** world direction that face-space +u maps to */
  readonly uAxis: Vec3;
  /** world direction that face-space +v maps to */
  readonly vAxis: Vec3;
}

const V: Record<string, Vec3> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

export const FACE_FRAME: Readonly<Record<Face, FaceFrame>> = {
  F: { face: 'F', n: V.pz, uAxis: V.px, vAxis: V.py },
  B: { face: 'B', n: V.nz, uAxis: V.nx, vAxis: V.py },
  R: { face: 'R', n: V.px, uAxis: V.nz, vAxis: V.py },
  L: { face: 'L', n: V.nx, uAxis: V.pz, vAxis: V.py },
  U: { face: 'U', n: V.py, uAxis: V.px, vAxis: V.nz },
  D: { face: 'D', n: V.ny, uAxis: V.px, vAxis: V.pz },
};

export const FACES: readonly Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];

function vec3Key(v: Vec3): string {
  return `${v[0]},${v[1]},${v[2]}`;
}

const FRAME_BY_NORMAL = new Map<string, FaceFrame>(
  FACES.map((f) => [vec3Key(FACE_FRAME[f].n), FACE_FRAME[f]]),
);

/** The face whose outward normal is `n` (exact integer vector). */
export function faceOfNormal(n: Vec3): Face {
  const frame = FRAME_BY_NORMAL.get(vec3Key(n));
  if (!frame) throw new Error(`no face with normal ${vec3Key(n)}`);
  return frame.face;
}

/**
 * World position of the cubie owning face cell (i,j): its center coordinate.
 * E.g. F (0,0) → (−1,−1,1): bottom-left-front corner cubie.
 */
export function cellCubiePos(face: Face, i: number, j: number): Vec3 {
  const { n, uAxis, vAxis } = FACE_FRAME[face];
  return [
    (i - 1) * uAxis[0] + (j - 1) * vAxis[0] + n[0],
    (i - 1) * uAxis[1] + (j - 1) * vAxis[1] + n[1],
    (i - 1) * uAxis[2] + (j - 1) * vAxis[2] + n[2],
  ];
}

/**
 * World point on a face's outer plane at face coords (u,v) ∈ [0,3]².
 * Cube spans [−1.5,1.5]; the plane sits at 1.5·n (outer surface).
 */
export function facePoint(face: Face, u: number, v: number): Vec3 {
  const { n, uAxis, vAxis } = FACE_FRAME[face];
  return [
    (u - 1.5) * uAxis[0] + (v - 1.5) * vAxis[0] + 1.5 * n[0],
    (u - 1.5) * uAxis[1] + (v - 1.5) * vAxis[1] + 1.5 * n[1],
    (u - 1.5) * uAxis[2] + (v - 1.5) * vAxis[2] + 1.5 * n[2],
  ];
}

export function vecEqual(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
