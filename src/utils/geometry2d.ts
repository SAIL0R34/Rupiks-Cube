/** small 2D helpers shared by the splitter and plotting code */

export interface Pt2 {
  u: number;
  v: number;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** squared distance point→segment, plus the segment parameter of the closest point */
export function pointSegmentDistance2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist2: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) {
    const ex = px - ax;
    const ey = py - ay;
    return { dist2: ex * ex + ey * ey, t: 0 };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return { dist2: ex * ex + ey * ey, t };
}

export function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - pts[i - 2];
    const dy = pts[i + 1] - pts[i - 1];
    len += Math.hypot(dx, dy);
  }
  return len;
}
