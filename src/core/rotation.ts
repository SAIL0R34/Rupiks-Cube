/**
 * Integer 3×3 rotation matrices for the cube orientation group.
 *
 * Every legal cube orientation has entries in {−1, 0, +1}, so exact integer
 * arithmetic accumulates zero drift over arbitrarily many moves. Matrices are
 * INTERNED: `internMat()` returns the shared frozen instance from the
 * 24-element rotation group, making orientation equality reference equality
 * and giving a stable index 0..23 for serialization.
 *
 * Convention: `p_world = R · p_local + pos` (column vectors, row-major flat
 * storage). `R⁻¹ = Rᵀ`.
 */

export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Vec3 = readonly [number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function matKey(m: Mat3): string {
  return m.join(',');
}

function mulMatRaw(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as number[];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as unknown as Mat3;
}

/** R·v for a column vector v */
export function applyVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ];
}

// ---------------------------------------------------------------------------
// The 24-element rotation group, built by BFS closure from the identity over
// the six quarter-turn generators (both directions of each axis).
// ---------------------------------------------------------------------------

/** the six ±90° rotations about the world axes (the generators) */
const GENERATORS: Mat3[] = [
  [1, 0, 0, 0, 0, 1, 0, -1, 0],   // Rot(−90°, x)
  [1, 0, 0, 0, 0, -1, 0, 1, 0],   // Rot(+90°, x)
  [0, 0, -1, 0, 1, 0, 1, 0, 0],   // Rot(−90°, y)
  [0, 0, 1, 0, 1, 0, -1, 0, 0],   // Rot(+90°, y)
  [0, 1, 0, -1, 0, 0, 0, 0, 1],   // Rot(−90°, z)
  [0, -1, 0, 1, 0, 0, 0, 0, 1],   // Rot(+90°, z)
];

function buildGroup(): Mat3[] {
  const seen = new Map<string, Mat3>();
  seen.set(matKey(IDENTITY), IDENTITY);
  const queue: Mat3[] = [IDENTITY];
  while (queue.length > 0) {
    const m = queue.shift()!;
    for (const g of GENERATORS) {
      const prod = mulMatRaw(g, m);
      const key = matKey(prod);
      if (!seen.has(key)) {
        seen.set(key, Object.freeze(prod));
        queue.push(prod);
      }
    }
  }
  const group = [...seen.values()];
  if (group.length !== 24) {
    throw new Error(`rotation group closure failed: ${group.length} elements, expected 24`);
  }
  return group;
}

const GROUP: Mat3[] = buildGroup();
const GROUP_INDEX = new Map<string, number>(GROUP.map((m, i) => [matKey(m), i]));

/** the full 24-element rotation group (frozen instances) */
export function rotationGroup(): readonly Mat3[] {
  return GROUP;
}

/** matrix multiply with interning — the result is always a group member */
export function mulMat(a: Mat3, b: Mat3): Mat3 {
  return internMat(mulMatRaw(a, b));
}

/** canonical shared instance for an exact rotation-group matrix */
export function internMat(m: Mat3): Mat3 {
  const i = GROUP_INDEX.get(matKey(m));
  if (i === undefined) {
    throw new Error(`matrix not in rotation group: ${matKey(m)}`);
  }
  return GROUP[i];
}

/** stable index 0..23 for serialization */
export function orientationIndex(m: Mat3): number {
  const i = GROUP_INDEX.get(matKey(m));
  if (i === undefined) throw new Error(`matrix not in rotation group: ${matKey(m)}`);
  return i;
}

export function orientationFromIndex(i: number): Mat3 {
  if (!Number.isInteger(i) || i < 0 || i >= 24) {
    throw new Error(`bad orientation index: ${i}`);
  }
  return GROUP[i];
}

// ---------------------------------------------------------------------------
// Axis quarter/half-turn matrices (the move building blocks).
// Sign convention: a CLOCKWISE turn of a face viewed from outside the face is
// a rotation of −90° about the face's outward normal (right-handed frame).
// ---------------------------------------------------------------------------

/** Rot(−90°) about +x/+y/+z (i.e. CW viewed from the +axis side) */
export const AXIS_CW: Readonly<Record<'x' | 'y' | 'z', Mat3>> = {
  x: GENERATORS[0],
  y: GENERATORS[2],
  z: GENERATORS[4],
};

/** Rot(+90°) about +x/+y/+z */
export const AXIS_CCW: Readonly<Record<'x' | 'y' | 'z', Mat3>> = {
  x: GENERATORS[1],
  y: GENERATORS[3],
  z: GENERATORS[5],
};

/** Rot(180°) about +x/+y/+z */
export const AXIS_HALF: Readonly<Record<'x' | 'y' | 'z', Mat3>> = {
  x: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  y: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  z: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
};

/**
 * Turn matrix for `quarterTurns` CW quarter-turns (1, 2 or 3) of a face whose
 * outward normal is `normalSign * axis`. CW about the outward normal means:
 * normalSign=+1 → −90° per turn about +axis; normalSign=−1 → +90° per turn.
 * quarterTurns=3 is the CCW single turn (prime move).
 */
export function turnMat(
  axis: 'x' | 'y' | 'z',
  normalSign: 1 | -1,
  quarterTurns: 1 | 2 | 3,
): Mat3 {
  if (quarterTurns === 2) return AXIS_HALF[axis];
  const cw = (normalSign === 1 ? AXIS_CW : AXIS_CCW)[axis];
  const ccw = (normalSign === 1 ? AXIS_CCW : AXIS_CW)[axis];
  return quarterTurns === 1 ? cw : ccw;
}
