/**
 * StickerTexture — one canvas + CanvasTexture per sticker (54 total).
 *
 * Canvas convention: tile-local (s,t) draws at pixel (s·W, (1−t)·H) with
 * texture.flipY = true (Three.js default), which agrees with the sticker-plane
 * basis makeBasis(su, sv, localNormal) BY CONSTRUCTION — both sides read the
 * same FACE_FRAME table from core/faces.ts.
 *
 * Strokes are drawn incrementally: appending a stroke only draws the new
 * polyline; a full redraw is only needed on undo/erase/load.
 */

import * as THREE from 'three';
import type { Stroke } from '../core/stickers';

export const STICKER_TEX_SIZE = 256;

export class StickerTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private version = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STICKER_TEX_SIZE;
    this.canvas.height = STICKER_TEX_SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = 4;
    this.clear();
  }

  /** whiteboard base with a faint inner border */
  private clear(): void {
    const c = this.ctx;
    c.fillStyle = '#f4f1ea';
    c.fillRect(0, 0, STICKER_TEX_SIZE, STICKER_TEX_SIZE);
    c.strokeStyle = 'rgba(0,0,0,0.10)';
    c.lineWidth = 6;
    c.strokeRect(3, 3, STICKER_TEX_SIZE - 6, STICKER_TEX_SIZE - 6);
    this.texture.needsUpdate = true;
  }

  /** redraw from scratch (undo, erase, load) */
  redrawAll(strokes: readonly Stroke[]): void {
    this.clear();
    for (const s of strokes) this.drawStroke(s);
    this.texture.needsUpdate = true;
  }

  /** draw one more stroke on top (plotting/manual drawing hot path) */
  appendStroke(stroke: Stroke): void {
    this.drawStroke(stroke);
    this.texture.needsUpdate = true;
  }

  private drawStroke(s: Stroke): void {
    if (s.pts.length < 4) return;
    const c = this.ctx;
    const W = STICKER_TEX_SIZE;
    const px = (s: number) => s * W;
    const py = (t: number) => (1 - t) * W;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (s.travel) {
      // travel move: thin, faint — the etch-a-sketch "getting there" line
      c.strokeStyle = 'rgba(60,58,54,0.28)';
      c.lineWidth = 1.4 * this.texScale();
    } else {
      const alpha = 0.55 + 0.4 * Math.min(1, Math.max(0, s.weight));
      c.strokeStyle = `rgba(32,30,28,${alpha.toFixed(3)})`;
      c.lineWidth = (1.7 + 1.5 * Math.min(1, Math.max(0, s.weight))) * this.texScale();
    }
    c.beginPath();
    c.moveTo(px(s.pts[0]), py(s.pts[1]));
    for (let i = 2; i < s.pts.length; i += 2) {
      c.lineTo(px(s.pts[i]), py(s.pts[i + 1]));
    }
    if (s.closed) c.closePath();
    c.stroke();
    c.restore();
    this.version++;
  }

  private texScale(): number {
    return STICKER_TEX_SIZE / 256;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /** dev-only (?debug=markers): asymmetric corner triangle in tile-local space */
  drawDevCornerMark(): void {
    const c = this.ctx;
    const W = STICKER_TEX_SIZE;
    c.save();
    c.fillStyle = 'rgba(216,72,59,0.85)';
    // top-left corner of TILE space: (s≈0.06..0.3, t≈0.94..0.7) → pixels (s·W, (1−t)·W)
    c.beginPath();
    c.moveTo(0.06 * W, 0.06 * W);
    c.lineTo(0.30 * W, 0.06 * W);
    c.lineTo(0.06 * W, 0.30 * W);
    c.closePath();
    c.fill();
    c.restore();
    this.texture.needsUpdate = true;
  }
}
