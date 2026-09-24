/**
 * IMAGE → ETCH conversion pipeline (runs inside the worker).
 *
 * normalize → blur → contrast stretch → Sobel + NMS + hysteresis → contour
 * tracing → RDP simplification → tone hatching → feature priority → continuous
 * trajectory planning.
 *
 * The image is expected to be pre-cropped to the screen aspect on the main
 * thread, so the whole frame maps to the full drawable area.
 */
import { boxBlur, contrastStretch, localContrast, rgbaToGray, toneThreshold, darkBlobMask } from './preprocess';
import { detectEdges } from './edgeDetection';
import { stitchFragments, traceContours } from './contours';
import { polylineLength, rdp } from './simplify';
import { planTrajectory, scoreContour, type Scored } from './pathPlanner';
import type { Complexity, EtchPlan } from './types';

/** Laplacian passes along polyline vertices (endpoints pinned) — minimal
 * mode uses it to dissolve JPEG staircase noise in traced geometry. */
function smoothPolyline(xs: number[], ys: number[], passes = 3): [number[], number[]] {
  const n = xs.length;
  if (n < 5) return [xs, ys];
  let ax = xs;
  let ay = ys;
  for (let p = 0; p < passes; p++) {
    const bx = ax.slice();
    const by = ay.slice();
    ax = ax.slice();
    ay = ay.slice();
    for (let i = 1; i < n - 1; i++) {
      ax[i] = (bx[i - 1] + 2 * bx[i] + bx[i + 1]) / 4;
      ay[i] = (by[i - 1] + 2 * by[i] + by[i + 1]) / 4;
    }
  }
  return [ax, ay];
}

interface ModeConfig {
  size: number; // working resolution on the long edge
  blur: number;
  minLenFrac: number; // minimum contour length, fraction of image diagonal
  maxContours: number;
  rdpFrac: number; // RDP epsilon as fraction of size
  hatchStep: number; // 0 disables tone hatching
  keepFrac: number;
}

const MODES: Record<Complexity, ModeConfig> = {
  minimal: { size: 1180, blur: 1, minLenFrac: 0.045, maxContours: 44, rdpFrac: 0.0024, hatchStep: 0, keepFrac: 0.95 },
  standard: { size: 1180, blur: 1, minLenFrac: 0.0045, maxContours: 760, rdpFrac: 0.0016, hatchStep: 21, keepFrac: 1 },
  obsessed: { size: 1180, blur: 1, minLenFrac: 0.005, maxContours: 900, rdpFrac: 0.0012, hatchStep: 15, keepFrac: 1 },
};

export interface PipelineProgress {
  (stage: string, value: number): void;
}

export function processImageData(
  img: ImageData,
  mode: Complexity,
  onProgress: PipelineProgress = () => {},
): EtchPlan {
  const t0 = performance.now();
  const cfg = MODES[mode];
  let w = img.width;
  let h = img.height;
  let gray: Float32Array;

  onProgress('Reading image', 0.06);
  {
    // downsample to the working size with a simple 2x-summing box filter
    const scale = cfg.size / Math.max(w, h);
    if (scale < 1) {
      const w2 = Math.round(w * scale);
      const h2 = Math.round(h * scale);
      gray = downsampleToGray(img, w2, h2);
      w = w2;
      h = h2;
    } else {
      gray = rgbaToGray(img.data as unknown as Uint8ClampedArray, w, h);
    }
  }

  onProgress('Stabilizing tonal structure', 0.14);
  gray = boxBlur(gray, w, h, cfg.blur);
  gray = contrastStretch(gray, 0.015, 0.985);
  // local contrast: amplify weak gradients (soft faces, faded skies) so
  // high-value dark blobs — eyes, mouths, sun discs — survive edge gating
  gray = localContrast(gray, w, h, 10, mode === 'obsessed' ? 42 : 36);

  onProgress('Detecting edges', 0.24);
  const edges = detectEdges(gray, w, h, {
    highScale: mode === 'obsessed' ? 0.5 : 0.52,
    lowScale: 0.30,
  });

  // how close edges are to each pixel — hatching must not cross the subject:
  // the reference shades only the empty ground, never over the figure
  let hatchNear: Float32Array | null = null;
  if (cfg.hatchStep) {
    const m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = edges.mask[i] ? 1 : 0;
    hatchNear = boxBlur(m, w, h, Math.max(3, Math.round(cfg.hatchStep * 0.7)));
  }

  onProgress('Tracing important features', 0.36);
  const raw = traceContours(edges.mask, edges.mag, w, h);
  const stitched = stitchFragments(raw, mode === 'minimal' ? 14.0 : 5.0);

  const diag = Math.hypot(w, h);
  let contours: Scored[] = [];
  for (const c of stitched) {
    const len = polylineLength(c.xs, c.ys);
    if (len < cfg.minLenFrac * diag) continue;
    const s = rdp(c.xs, c.ys, cfg.rdpFrac * cfg.size);
    if (s.xs.length < 2) continue;
    let xs = Array.from(s.xs);
    let ys = Array.from(s.ys);
    if (mode === 'minimal') [xs, ys] = smoothPolyline(xs, ys);
    contours.push({ xs, ys, closed: c.closed, strength: c.strength, kind: 'edge' });
  }

  // dark-blob pass: compact dark tone events the gradient pass misses —
  // eyes, smiles, faces drawn dark on light. Traced from its own mask.
  if (mode !== 'minimal') {
    const blob = darkBlobMask(gray, w, h, {
      rInner: Math.max(2, Math.round(cfg.size * 0.006)),
      rOuter: Math.max(8, Math.round(cfg.size * 0.045)),
      contrast: mode === 'obsessed' ? 0.11 : 0.115,
      minArea: 55,
      maxArea: 0.09 * w * h,
    });
    const blobContours = traceContours(blob.mask, blob.mag, w, h);
    for (const bc of blobContours.slice(0, 120)) {
      const len = polylineLength(bc.xs, bc.ys);
      if (len < cfg.minLenFrac * diag) continue;
      const s = rdp(bc.xs, bc.ys, cfg.rdpFrac * cfg.size);
      if (s.xs.length < 2) continue;
      contours.push({ xs: Array.from(s.xs), ys: Array.from(s.ys), closed: bc.closed, strength: 1.2 + bc.strength, kind: 'edge' });
    }
  }

  onProgress('Prioritizing structure', 0.5);
  const scored = contours
    .map((c) => ({ c, score: scoreContour({ ...c, kind: 'edge' } as Scored, w, h) }))
    .sort((a, b) => b.score - a.score);
  const keep = Math.min(cfg.maxContours, Math.max(6, Math.round(scored.length * cfg.keepFrac)));
  contours = scored.slice(0, keep).map((s) => s.c);

  onProgress('Weaving tone with hatching', 0.6);
  if (cfg.hatchStep > 0) {
    contours.push(...hatchTones(gray, w, h, cfg.hatchStep, toneThreshold(gray), mode, hatchNear));
  }

  onProgress('Planning one continuous path', 0.72);
  const plan = planTrajectory(contours, w, h, {
    travelPenalty: mode === 'obsessed' ? 0.1 : 0.22,
  });

  onProgress('Ready to sketch', 0.98);
  console.debug(`[etch] ${mode} pipeline: ${plan.polys.length} polys in ${(performance.now() - t0).toFixed(0)}ms`);
  return plan;
}

/** area-average downsample straight into grayscale */
function downsampleToGray(img: ImageData, w2: number, h2: number): Float32Array {
  const { data, width: w, height: h } = img;
  const out = new Float32Array(w2 * h2);
  const sx = w / w2;
  const sy = h / h2;
  for (let y = 0; y < h2; y++) {
    const y0 = Math.floor(y * sy),
      y1 = Math.min(h - 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w2; x++) {
      const x0 = Math.floor(x * sx),
        x1 = Math.min(w - 1, Math.floor((x + 1) * sx));
      let acc = 0,
        n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const p = (yy * w + xx) * 4;
          let r = data[p],
            g = data[p + 1],
            b = data[p + 2];
          const a = data[p + 3] / 255;
          if (a < 1) {
            r = r * a + 255 * (1 - a);
            g = g * a + 255 * (1 - a);
            b = b * a + 255 * (1 - a);
          }
          acc += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          n++;
        }
      }
      out[y2(x, y, w2)] = acc / Math.max(1, n) / 255;
    }
  }
  return out;
}
const y2 = (x: number, y: number, w: number) => y * w + x;

/**
 * Tone hatching: dark regions of the photo get parallel horizontal pen runs —
 * the classic way to fake gray on an Etch A Sketch. Runs follow the gray field
 * and receive micro-jitter so they read as hand-laid lines.
 */
function hatchTones(
  gray: Float32Array,
  w: number,
  h: number,
  step: number,
  threshold: number,
  mode: Complexity,
  near: Float32Array | null,
): Scored[] {
  const out: Scored[] = [];
  const jitterAmp = step * 0.16;
  for (let y = step * 0.7; y < h - step * 0.4; y += step) {
    let runStart = -1;
    let sum = 0,
      cnt = 0;
    for (let x = 0; x <= w; x++) {
      const gx = Math.min(w - 1, x);
      const gxi = Math.floor(y) * w + gx;
      const dark = x < w ? gray[gxi] : 1;
      // suppress hatching beside contours — shade the ground, not the figure
      const besideEdge = near ? near[gxi] > 0.04 : false;
      // a run continues while dark with small gaps
      if (dark < threshold && !besideEdge) {
        if (runStart < 0) {
          runStart = x;
          sum = 0;
          cnt = 0;
        }
        sum += gray[gxi];
        cnt++;
      } else if (runStart >= 0) {
        // run ends on tone lightening OR on a contour boundary
        const gapStart = x;
        let gap = 0;
        while (
          x + gap < w &&
          (gray[Math.floor(y) * w + x + gap] >= threshold || (near && near[Math.floor(y) * w + x + gap] > 0.04))
        ) gap++;
        if (gap > step * 0.6 || x >= w) {
          emit(runStart, x, y, sum, cnt);
          runStart = -1;
        } else x = gapStart + gap - 1;
      }
    }
    if (runStart >= 0) emit(runStart, w, y, sum, cnt);
  }
  function emit(x0: number, x1: number, y: number, sum: number, cnt: number) {
    const len = x1 - x0;
    if (len < step * (mode === 'obsessed' ? 1.1 : 1.6)) return;
    const xs: number[] = [];
    const ys: number[] = [];
    const n = Math.max(2, Math.round(len / (step * 0.8)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + len * t;
      const j = (Math.sin((y * 91.7 + x * 0.37) * 0.13) + Math.sin(x * 0.9 + y * 3.1)) * jitterAmp;
      xs.push(x);
      ys.push(y + j);
    }
    out.push({
      xs,
      ys,
      closed: false,
      strength: 0.26 + (1 - sum / Math.max(1, cnt) / Math.max(threshold, 1)) * (len / w),
      kind: 'hatch',
    });
  }
  // keep only the darkest / most explanatory runs — hatching is texture, not the piece
  out.sort((a, b) => b.strength - a.strength);
  const cap = mode === 'obsessed' ? 640 : mode === 'standard' ? 230 : 90;
  if (out.length > cap) out.length = cap;
  return out;
}
