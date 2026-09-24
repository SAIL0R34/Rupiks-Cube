/**
 * Unfolded cross-net export — PNG and SVG, composed from the 54 CURRENT tile
 * images so scrambled states export exactly as distributed.
 *
 * Net layout:      U
 *               L  F  R  B
 *                  D
 */

import type { Session } from '../core/history';
import type { Face } from '../core/faces';
import { faceCellAffines } from '../imaging/faceBlit';
import { decodeDataUrl } from '../imaging/compose';
import { downloadBlob } from '../utils/download';

const CELL = 256;
const GUTTER = 26;

const SLOTS: Array<{ face: Face; x: number; y: number }> = (() => {
  const o = CELL + GUTTER;
  return [
    { face: 'U', x: o, y: 0 },
    { face: 'L', x: 0, y: o },
    { face: 'F', x: o, y: o },
    { face: 'R', x: 2 * o, y: o },
    { face: 'B', x: 3 * o, y: o },
    { face: 'D', x: o, y: 2 * o },
  ];
})();

function netSize(): { w: number; h: number } {
  const o = CELL + GUTTER;
  return { w: 4 * o - GUTTER + 20, h: 3 * o - GUTTER + 20 };
}

/** compose one face (3×3 current tiles) into a canvas → dataURL */
async function faceDataUrl(sess: Session, face: Face): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * 3;
  canvas.height = CELL * 3;
  const ctx = canvas.getContext('2d')!;
  const affines = faceCellAffines(sess.cube, face);
  const imgs = await Promise.all(
    affines.map((a) => {
      const url = sess.tiles.get(a.stickerId);
      return url ? decodeDataUrl(url) : Promise.resolve(null);
    }),
  );
  affines.forEach((a, k) => {
    const img = imgs[k];
    const dx = a.i * CELL;
    const dy = (2 - a.j) * CELL; // face v up → canvas y down
    ctx.fillStyle = '#efece4';
    ctx.fillRect(dx, dy, CELL, CELL);
    if (!img) return;
    // tile-space px of the face-cell corners (quad maps cell → tile)
    const px = (q: { s: number; t: number }) => [q.s * CELL, (1 - q.t) * CELL] as const;
    // output-cell corners: top-left = face (i, j+1) = quad[3]; x+ → quad[2];
    // y+ (canvas down) = face v− → quad[0]
    const [ox, oy] = px(a.quad[3]);
    const ex = [px(a.quad[2])[0] - ox, px(a.quad[2])[1] - oy];
    const ey = [px(a.quad[0])[0] - ox, px(a.quad[0])[1] - oy];
    const det = ex[0] * ey[1] - ex[1] * ey[0];
    if (Math.abs(det) < 1e-6) return;
    // affine tile→cell: A·ex = (CELL,0), A·ey = (0,CELL)
    const ia = (CELL * ey[1]) / det;
    const ib = (-CELL * ey[0]) / det;
    const ic = (-CELL * ex[1]) / det;
    const id = (CELL * ex[0]) / det;
    const e = dx - (ia * ox + ic * oy);
    const f = dy - (ib * ox + id * oy);
    ctx.save();
    ctx.setTransform(ia, ib, ic, id, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  });
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function faceUrls(sess: Session): Promise<Record<Face, string>> {
  const out = {} as Record<Face, string>;
  for (const slot of SLOTS) {
    // eslint-disable-next-line no-await-in-loop
    out[slot.face] = await faceDataUrl(sess, slot.face);
  }
  return out;
}

export async function downloadNetPNG(sess: Session): Promise<void> {
  const urls = await faceUrls(sess);
  const { w, h } = netSize();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1efe9';
  ctx.fillRect(0, 0, w, h);
  const imgs = await Promise.all(SLOTS.map((s) => decodeDataUrl(urls[s.face])));
  SLOTS.forEach((s, k) => ctx.drawImage(imgs[k], s.x + 10, s.y + 10));
  canvas.toBlob((b) => {
    if (b) downloadBlob(b, 'twistdraw-net.png');
  }, 'image/png');
}

export async function downloadNetSVG(sess: Session): Promise<void> {
  const urls = await faceUrls(sess);
  const { w, h } = netSize();
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#f1efe9"/>`,
  ];
  for (const s of SLOTS) {
    parts.push(
      `<image x="${s.x + 10}" y="${s.y + 10}" width="${CELL * 3}" height="${CELL * 3}" href="${urls[s.face]}"/>`,
      `<rect x="${s.x + 9}" y="${s.y + 9}" width="${CELL * 3 + 2}" height="${CELL * 3 + 2}" fill="none" stroke="#b9b3a6" stroke-width="1.5" rx="6"/>`,
    );
  }
  parts.push('</svg>');
  downloadBlob(new Blob([parts.join('\n')], { type: 'image/svg+xml' }), 'twistdraw-net.svg');
}
