/** Sobel gradient with non-maximum suppression and hysteresis thresholding (Canny-style). */

export interface EdgeMap {
  mask: Uint8Array; // 1 = thin edge pixel
  mag: Float32Array;
  w: number;
  h: number;
}

export function detectEdges(
  gray: Float32Array,
  w: number,
  h: number,
  opts: { lowScale?: number; highScale?: number } = {},
): EdgeMap {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1],
        b = gray[i - w],
        c = gray[i - w + 1];
      const d = gray[i - 1],
        e = gray[i + 1];
      const f = gray[i + w - 1],
        g = gray[i + w],
        g2 = gray[i + w + 1];
      const sx = -a - 2 * d - f + c + 2 * e + g2;
      const sy = a + 2 * b + c - f - 2 * g2 - g;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }

  // non-maximum suppression along gradient direction
  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      let dx = gx[i],
        dy = gy[i];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const q = (u: number, v: number) => {
        const xi = Math.round(x + u);
        const yi = Math.round(y + v);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
        return mag[yi * w + xi];
      };
      const n1 = q(dx, dy);
      const n2 = q(-dx, -dy);
      thin[i] = m >= n1 && m >= n2 ? m : 0;
    }
  }

  // hysteresis with adaptive thresholds
  const sample: number[] = [];
  const st = Math.max(1, Math.floor(thin.length / 20000));
  for (let i = 0; i < thin.length; i += st) if (thin[i] > 0) sample.push(thin[i]);
  sample.sort((a, b) => a - b);
  const p97 = sample[Math.floor(sample.length * 0.97)] || 0.3;
  const high = p97 * (opts.highScale ?? 0.85);
  const low = high * (opts.lowScale ?? 0.38);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < thin.length; i++) if (thin[i] >= low) mask[i] = thin[i] >= high ? 2 : 1;

  // hysteresis propagation: weak pixels adjacent to strong ones become strong
  let changed = true;
  let guard = 6;
  while (changed && guard--) {
    changed = false;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] !== 1) continue;
        if (
          mask[i - 1] === 2 ||
          mask[i + 1] === 2 ||
          mask[i - w] === 2 ||
          mask[i + w] === 2 ||
          mask[i - w - 1] === 2 ||
          mask[i - w + 1] === 2 ||
          mask[i + w - 1] === 2 ||
          mask[i + w + 1] === 2
        ) {
          mask[i] = 2;
          changed = true;
        }
      }
    }
  }

  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 1 ? 0 : mask[i] === 2 ? 1 : 0;
  return { mask, mag, w, h };
}
