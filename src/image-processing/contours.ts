/**
 * Contour tracing over the thinned edge map.
 *
 * Strategy: treat edge pixels as an 8-connected graph. Walk open strokes from
 * endpoints, split at junctions, then close remaining loops. Fragments that
 * meet at junctions are stitched back into longer polylines.
 */

export interface RawContour {
  xs: Float64Array;
  ys: Float64Array;
  closed: boolean;
  strength: number; // mean gradient magnitude along the trace
}

const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export function traceContours(mask: Uint8Array, mag: Float32Array, w: number, h: number): RawContour[] {
  const visited = new Uint8Array(w * h);
  const degree = (x: number, y: number): number => {
    let n = 0;
    for (const [dx, dy] of NB) {
      const xx = x + dx,
        yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) n++;
    }
    return n;
  };

  const contours: RawContour[] = [];

  const walk = (sx: number, sy: number, closed: boolean) => {
    const xs: number[] = [sx];
    const ys: number[] = [sy];
    let strength = mag[sy * w + sx];
    visited[sy * w + sx] = 1;
    let x = sx,
      y = sy;
    let px = 0,
      py = 0;
    let guard = 3 * (w + h);

    while (guard--) {
      let bx = -1,
        by = -1,
        best = -1;
      for (const [dx, dy] of NB) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (!mask[yy * w + xx] || visited[yy * w + xx]) continue;
        // prefer continuing the previous direction; penalize reversals
        let score = mag[yy * w + xx];
        if (px || py) {
          const dot = (dx * px + dy * py) / (Math.hypot(dx, dy) * Math.hypot(px, py) || 1);
          score *= 0.5 + 0.8 * Math.max(0, dot);
          if (dot < -0.5) score *= 0.01;
        } else {
          const dg = degree(xx, yy);
          if (dg === 2) score *= 1.3; // keep going through corridors
        }
        if (score > best) {
          best = score;
          bx = xx;
          by = yy;
        }
      }
      if (bx < 0) break;
      px = bx - x;
      py = by - y;
      x = bx;
      y = by;
      visited[y * w + x] = 1;
      strength += mag[y * w + x];
      xs.push(x);
      ys.push(y);
      if (closed && x === sx && y === sy) break;
    }

    if (xs.length >= 3) {
      contours.push({
        xs: Float64Array.from(xs),
        ys: Float64Array.from(ys),
        closed: closed || (xs.length > 4 && Math.hypot(xs[0] - xs[xs.length - 1], ys[0] - ys[ys.length - 1]) <= 2),
        strength: strength / xs.length,
      });
    }
  };

  const at = (x: number, y: number) => mask[y * w + x];

  // 1. open strokes from endpoints
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) && !visited[y * w + x] && degree(x, y) === 1) walk(x, y, false);
    }
  }
  // 2. fragments from junctions
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) && !visited[y * w + x] && degree(x, y) >= 3) walk(x, y, false);
    }
  }
  // 3. leftover closed loops
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) && !visited[y * w + x]) walk(x, y, true);
    }
  }

  return contours;
}

/** stitch fragments that meet head-to-tail within `tol` px (junction reunification) */
export function stitchFragments(contours: RawContour[], tol = 2.6): RawContour[] {
  const used = new Uint8Array(contours.length);
  const out: RawContour[] = [];

  const end = (c: RawContour, head: boolean) =>
    head ? { x: c.xs[0], y: c.ys[0] } : { x: c.xs[c.xs.length - 1], y: c.ys[c.ys.length - 1] };

  for (let i = 0; i < contours.length; i++) {
    if (used[i]) continue;
    let cur = contours[i];
    used[i] = 1;
    let guard = 200;
    while (guard--) {
      const tail = end(cur, false);
      const head = end(cur, true);
      let merged = false;
      for (let j = 0; j < contours.length; j++) {
        if (used[j]) continue;
        const c = contours[j];
        const t = end(c, false);
        const h0 = end(c, true);
        if (Math.hypot(t.x - head.x, t.y - head.y) <= tol) {
          cur = join(c, cur, true);
        } else if (Math.hypot(h0.x - tail.x, h0.y - tail.y) <= tol) {
          cur = join(cur, c, false);
        } else continue;
        used[j] = 1;
        merged = true;
        break;
      }
      if (!merged) break;
    }
    out.push(cur);
  }
  return out;
}

function join(a: RawContour, b: RawContour, reverseA: boolean): RawContour {
  const ax = reverseA ? [...a.xs].reverse() : a.xs;
  const ay = reverseA ? [...a.ys].reverse() : a.ys;
  return {
    xs: Float64Array.from([...ax, ...b.xs]),
    ys: Float64Array.from([...ay, ...b.ys]),
    closed: false,
    strength: (a.strength + b.strength) / 2,
  };
}
