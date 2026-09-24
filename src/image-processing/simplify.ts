/** Ramer–Douglas–Peucker simplification + helpers. */

export function rdp(xs: Float64Array, ys: Float64Array, eps: number): { xs: Float64Array; ys: Float64Array } {
  const n = xs.length;
  if (n < 3) return { xs, ys };
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = xs[a],
      ay = ys[a];
    const bx = xs[b],
      by = ys[b];
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1,
      maxI = a;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xs[i] - ax) * dy - (ys[i] - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > eps) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const kxs: number[] = [];
  const kys: number[] = [];
  for (let i = 0; i < n; i++)
    if (keep[i]) {
      kxs.push(xs[i]);
      kys.push(ys[i]);
    }
  return { xs: Float64Array.from(kxs), ys: Float64Array.from(kys) };
}

export function polylineLength(xs: Float64Array, ys: Float64Array): number {
  let l = 0;
  for (let i = 1; i < xs.length; i++) l += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return l;
}

export function closedArea(xs: Float64Array, ys: Float64Array): number {
  let a = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(a / 2);
}
