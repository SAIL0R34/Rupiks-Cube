/**
 * Image composition — source files → square working canvases/dataURLs.
 *
 * The cube faces are square, so every upload is composed onto a square canvas
 * in the chosen fit mode BEFORE anything else touches it (no aspect surprises
 * downstream).
 */

export type FitMode = 'contain' | 'cover' | 'stretch';

export const WORK_SIZE = 768;

export async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
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

export function decodeDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

/** compose an image onto a WORK_SIZE² canvas per the fit mode */
export function toSquareCanvas(
  src: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  fit: FitMode = 'contain',
): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  const canvas = document.createElement('canvas');
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // white letterbox reads as empty tile
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

/** compose a source image to a square JPEG dataURL (compact persistence) */
export function toSquareDataUrl(
  src: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  fit: FitMode = 'contain',
  quality = 0.85,
): string {
  return toSquareCanvas(src, fit).toDataURL('image/jpeg', quality);
}
