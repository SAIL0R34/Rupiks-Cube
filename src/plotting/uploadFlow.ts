/**
 * Upload flow: file → square canvas (aspect handling — the vendored pipeline
 * stretches the full frame to [0,1]², so composition happens HERE) → worker
 * → mapped plan → PlotSession.
 */

import type { Complexity, EtchPlan } from '../image-processing/types';
import { ProcessorClient } from '../workers/processorClient';
import { mapPlanToFace } from './planMapper';
import { startPlot } from './PlotSession';
import { useCubeStore } from '../store/useCubeStore';

const WORK_SIZE = 1024; // pipeline downsamples to 1180 internally anyway

let client: ProcessorClient | null = null;

function processor(): ProcessorClient {
  if (!client) client = new ProcessorClient();
  return client;
}

export interface UploadOptions {
  mode: Complexity;
  fit: 'contain' | 'cover' | 'stretch';
  clearFaceFirst: boolean;
}

export const DEFAULT_UPLOAD_OPTIONS: UploadOptions = {
  mode: 'standard',
  fit: 'contain',
  clearFaceFirst: true,
};

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** compose the image onto a square canvas per the fit mode */
function toSquareCanvas(src: ImageBitmap | HTMLImageElement, fit: UploadOptions['fit']): HTMLCanvasElement {
  const sw = 'width' in src ? src.width : 0;
  const sh = 'height' in src ? src.height : 0;
  const canvas = document.createElement('canvas');
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // white letterbox reads as "no ink"
  ctx.fillRect(0, 0, WORK_SIZE, WORK_SIZE);
  let dw = WORK_SIZE;
  let dh = WORK_SIZE;
  if (fit === 'contain') {
    const scale = Math.min(WORK_SIZE / sw, WORK_SIZE / sh);
    dw = sw * scale;
    dh = sh * scale;
  } else if (fit === 'cover') {
    const scale = Math.max(WORK_SIZE / sw, WORK_SIZE / sh);
    dw = sw * scale;
    dh = sh * scale;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (WORK_SIZE - dw) / 2, (WORK_SIZE - dh) / 2, dw, dh);
  return canvas;
}

export async function uploadAndSketch(file: File, opts: UploadOptions = DEFAULT_UPLOAD_OPTIONS): Promise<void> {
  const s = useCubeStore.getState();
  if (s.busy === 'plotting') {
    useCubeStore.setState({ banner: { text: 'Already etching — Esc to stop first', at: Date.now() } });
    return;
  }
  if (s.busy === 'turning') {
    useCubeStore.setState({ banner: { text: 'Cube is turning — try again in a moment', at: Date.now() } });
    return;
  }
  useCubeStore.setState({
    plotting: { status: 'processing', stage: 'Reading image', progress: 0 },
  });
  try {
    const bitmap = await loadBitmap(file);
    const canvas = toSquareCanvas(bitmap, opts.fit);
    const imageData = canvas.getContext('2d')!.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
    if ('close' in bitmap) bitmap.close();

    const plan: EtchPlan = await processor().process(imageData, opts.mode, (p) => {
      useCubeStore.setState({
        plotting: { status: 'processing', stage: p.stage, progress: p.value },
      });
    });

    if (opts.clearFaceFirst) {
      useCubeStore.getState().clearActiveFace();
    }
    const mapped = mapPlanToFace(plan);
    const ok = startPlot(mapped);
    if (!ok) {
      useCubeStore.setState({
        plotting: { status: 'idle', stage: '', progress: 0 },
        banner: { text: 'Could not start the plot right now', at: Date.now() },
      });
    }
  } catch (err) {
    useCubeStore.setState({
      plotting: { status: 'idle', stage: '', progress: 0 },
      banner: { text: `Sketch failed: ${String(err instanceof Error ? err.message : err)}`, at: Date.now() },
    });
  }
}
