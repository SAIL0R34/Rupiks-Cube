/**
 * Unfolded cross-net export — SVG (true vectors) and PNG.
 *
 * Net layout (face-space (u,v) ∈ [0,3]² per face, 1-unit gutters):
 *
 *          U
 *      L   F   R   B
 *          D
 *
 * Each face's strokes are converted from tile-local back to face coords via
 * tileToFace, so the net shows the artwork exactly as currently distributed
 * over the cube (scrambles included).
 */

import type { Session } from '../core/history';
import type { Face } from '../core/faces';
import { FACES } from '../core/faces';
import { tileToFace } from '../core/transform';
import { downloadBlob } from '../utils/download';

const FACE = 300; // px per face unit-cell ×3 → face is 3 cells
const CELL = FACE;
const GUTTER = 24;

interface NetSlot {
  face: Face;
  x: number; // net origin px
  y: number;
}

/** cross layout: U on top; L F R B across; D below (centered on F) */
function netSlots(): NetSlot[] {
  const o = CELL + GUTTER;
  return [
    { face: 'U', x: o, y: 0 },
    { face: 'L', x: 0, y: o },
    { face: 'F', x: o, y: o },
    { face: 'R', x: 2 * o, y: o },
    { face: 'B', x: 3 * o, y: o },
    { face: 'D', x: o, y: 2 * o },
  ];
}

function netSize(): { w: number; h: number } {
  const o = CELL + GUTTER;
  return { w: 4 * o - GUTTER + 8, h: 3 * o - GUTTER + 8 };
}

/** collect the strokes of a face, in face coords */
function faceStrokes(sess: Session, face: Face): Array<{
  pts: number[];
  weight: number;
  travel: boolean;
  closed?: boolean;
}> {
  const out: Array<{ pts: number[]; weight: number; travel: boolean; closed?: boolean }> = [];
  for (const cubie of sess.cube.cubies) {
    for (const sticker of cubie.stickers) {
      for (const st of sticker.strokes) {
        const pts: number[] = [];
        for (let i = 0; i < st.pts.length; i += 2) {
          const p = tileToFace(cubie, sticker, st.pts[i], st.pts[i + 1]);
          if (p.face !== face) continue; // sticker rotated away; shouldn't happen mid-stroke
          pts.push(p.u, p.v);
        }
        if (pts.length >= 4) {
          out.push({ pts, weight: st.weight, travel: st.travel, ...(st.closed ? { closed: true } : {}) });
        }
      }
    }
  }
  return out;
}

export function buildNetSVG(sess: Session): string {
  const { w, h } = netSize();
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#f4f1ea"/>`,
  );
  for (const slot of netSlots()) {
    // tile grid
    for (let i = 0; i <= 3; i++) {
      parts.push(
        `<line x1="${slot.x + i * CELL}" y1="${slot.y}" x2="${slot.x + i * CELL}" y2="${slot.y + 3 * CELL}" stroke="#d8d2c4" stroke-width="1"/>`,
        `<line x1="${slot.x}" y1="${slot.y + i * CELL}" x2="${slot.x + 3 * CELL}" y2="${slot.y + i * CELL}" stroke="#d8d2c4" stroke-width="1"/>`,
      );
    }
    parts.push(
      `<rect x="${slot.x}" y="${slot.y}" width="${3 * CELL}" height="${3 * CELL}" fill="none" stroke="#b9b3a6" stroke-width="2" rx="4"/>`,
    );
    parts.push(
      `<text x="${slot.x + 8}" y="${slot.y + 20}" font-family="monospace" font-size="16" fill="#8a8478">${slot.face}</text>`,
    );
    // strokes (v === 0 at top → y = slot.y + u·CELL, x = slot.x + u·CELL)
    for (const s of faceStrokes(sess, slot.face)) {
      const alpha = s.travel ? 0.28 : 0.55 + 0.4 * Math.min(1, Math.max(0, s.weight));
      const widthPx = s.travel ? 1.2 : 1.6 + 1.6 * Math.min(1, Math.max(0, s.weight));
      const d = s.pts
        .map((_, i) => {
          if (i % 2 === 1) return '';
          const x = slot.x + s.pts[i] * CELL;
          const y = slot.y + (3 - s.pts[i + 1]) * CELL; // v up → y down
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ');
      parts.push(
        `<path d="${d} ${s.closed ? 'Z' : ''}" fill="none" stroke="rgba(32,30,28,${alpha.toFixed(2)})" stroke-width="${widthPx.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export function buildNetPNG(sess: Session): Promise<Blob> {
  const svg = buildNetSVG(sess);
  const { w, h } = netSize();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG rasterization failed'));
    };
    img.src = url;
  });
}

export function downloadNetSVG(sess: Session): void {
  downloadBlob(new Blob([buildNetSVG(sess)], { type: 'image/svg+xml' }), 'twistdraw-net.svg');
}

export async function downloadNetPNG(sess: Session): Promise<void> {
  downloadBlob(await buildNetPNG(sess), 'twistdraw-net.png');
}

export function faceList(): readonly Face[] {
  return FACES;
}
