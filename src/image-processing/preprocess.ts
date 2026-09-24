/** Downsample / grayscale / blur / contrast for the etch pipeline. Pure functions, worker-safe. */

export function rgbaToGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // luma; premultiply-ish against transparent backgrounds (white matte)
    let r = data[p],
      g = data[p + 1],
      b = data[p + 2];
    const a = data[p + 3] / 255;
    if (a < 1) {
      r = r * a + 255 * (1 - a);
      g = g * a + 255 * (1 - a);
      b = b * a + 255 * (1 - a);
    }
    out[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return out;
}

/** separable box blur, radius in px */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const rem = src[y * w + Math.max(0, x - r)];
      acc += add - rem;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const rem = tmp[Math.max(0, y - r) * w + x];
      acc += add - rem;
    }
  }
  return dst;
}

/** percentile histogram stretch to use the full dynamic range */
export function contrastStretch(g: Float32Array, lo = 0.02, hi = 0.98): Float32Array {
  const bins = 256;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < g.length; i++) hist[Math.min(bins - 1, (g[i] * bins) | 0)]++;
  const n = g.length;
  let loCut = 0,
    hiCut = 1;
  let cum = 0;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= n * lo) {
      loCut = b / bins;
      break;
    }
  }
  cum = 0;
  for (let b = bins - 1; b >= 0; b--) {
    cum += hist[b];
    if (cum >= n * (1 - hi)) {
      hiCut = (b + 1) / bins;
      break;
    }
  }
  const span = Math.max(0.02, hiCut - loCut);
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    out[i] = Math.min(1, Math.max(0, (g[i] - loCut) / span));
  }
  return out;
}

/** adaptive threshold for tone hatching: mean-median midpoint */
export function toneThreshold(g: Float32Array): number {
  const sample = 4096;
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(g.length / sample));
  for (let i = 0; i < g.length; i += step) vals.push(g[i]);
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.min(0.62, Math.max(0.38, median * 0.92));
}

/**
 * CLAHE-lite local contrast: per-tile gain amplifies weak local gradients
 * (soft faces, faded backgrounds) toward a target standard deviation while
 * leaving already-punchy regions alone. Gains are bilinearly interpolated so
 * tile borders never show. Returns a new buffer, values clamped to [0,255].
 */
export function localContrast(
  g: Float32Array,
  w: number,
  h: number,
  tiles = 8,
  targetStd = 42,
  maxGain = 2.8,
): Float32Array {
  const tx = Math.max(2, tiles);
  const ty = Math.max(2, Math.round((tiles * h) / w));
  const bw = w / tx;
  const bh = h / ty;
  const mean = new Float32Array(tx * ty);
  const gain = new Float32Array(tx * ty);
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let s = 0;
      let ss = 0;
      let n = 0;
      for (let y = Math.floor(j * bh); y < Math.min(h, (j + 1) * bh); y++) {
        for (let x = Math.floor(i * bw); x < Math.min(w, (i + 1) * bw); x++) {
          const v = g[y * w + x];
          s += v;
          ss += v * v;
          n++;
        }
      }
      const m = s / n;
      const sd = Math.sqrt(Math.max(0, ss / n - m * m));
      mean[j * tx + i] = m;
      // grayscale is 0..1 — targetStd stays in 0-255 units for callers
      gain[j * tx + i] = Math.min(maxGain, Math.max(0.9, (targetStd / 255) / Math.max(6 / 255, sd)));
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * ty - 0.5;
    const y0 = Math.max(0, Math.min(ty - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(ty - 1, y0 + 1));
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * tx - 0.5;
      const x0 = Math.max(0, Math.min(tx - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(tx - 1, x0 + 1));
      const wx = Math.min(1, Math.max(0, fx - x0));
      const gxy =
        (gain[y0 * tx + x0] * (1 - wx) + gain[y0 * tx + x1] * wx) * (1 - wy) +
        (gain[y1 * tx + x0] * (1 - wx) + gain[y1 * tx + x1] * wx) * wy;
      const mxy =
        (mean[y0 * tx + x0] * (1 - wx) + mean[y0 * tx + x1] * wx) * (1 - wy) +
        (mean[y1 * tx + x0] * (1 - wx) + mean[y1 * tx + x1] * wx) * wy;
      out[y * w + x] = Math.max(0, Math.min(255, mxy + (g[y * w + x] - mxy) * gxy));
    }
  }
  return out;
}

/**
 * Difference-of-blurs dark-blob detector: compact regions distinctly darker
 * than their surroundings — eyes, smiles, sun faces, any closed dark feature.
 * Sobel hysteresis misses these because a blob is a *tone* event, not a
 * gradient ridge. Returns a mask (+ strength map) sized for traceContours();
 * connected components outside [minArea, maxArea] are discarded.
 */
export function darkBlobMask(
  gray: Float32Array,
  w: number,
  h: number,
  opts: { rInner: number; rOuter: number; contrast: number; minArea: number; maxArea: number },
): { mask: Uint8Array; mag: Float32Array } {
  const n = w * h;
  const inner = boxBlur(gray, w, h, opts.rInner);
  const outer = boxBlur(gray, w, h, opts.rOuter);
  const mask = new Uint8Array(n);
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = outer[i] - inner[i]; // grayscale is 0..1 throughout the pipeline
    if (d > opts.contrast && inner[i] < 0.59) {
      mask[i] = 1;
      mag[i] = d;
    }
  }
  // component size filter — a small dark speck or an entire subject should
  // not masquerade as a feature
  const seen = new Uint8Array(n);
  const ids = new Int32Array(n);
  const stack = new Int32Array(n);
  const areas: number[] = [0];
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    id++;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    ids[i] = id;
    let area = 0;
    while (top) {
      const p = stack[--top];
      area++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; ids[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; ids[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; ids[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; ids[p + w] = id; stack[top++] = p + w; }
    }
    areas.push(area);
  }
  const keep = new Uint8Array(id + 1);
  for (let k = 1; k <= id; k++) keep[k] = areas[k] >= opts.minArea && areas[k] <= opts.maxArea ? 1 : 0;
  for (let i = 0; i < n; i++) if (ids[i] && !keep[ids[i]]) { mask[i] = 0; mag[i] = 0; }

  // trace contours expect thin ridges — convert solid blobs to their
  // boundary ring, exactly the outline an etch would draw around the feature
  const ring = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      if (mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) continue; // interior
      ring[p] = 1;
    }
  }
  return { mask: ring, mag };
}
