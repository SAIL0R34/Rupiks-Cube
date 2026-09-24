/**
 * StickerTexture — one canvas + CanvasTexture per sticker (54 total).
 *
 * Canvas convention: tile-local (s,t) draws at pixel (s·W, (1−t)·H) with
 * texture.flipY = true (Three.js default), agreeing with the sticker-plane
 * basis makeBasis(su, sv, localNormal) BY CONSTRUCTION — both sides read the
 * same FACE_FRAME table from core/faces.ts.
 *
 * Content = an image dataURL applied whole (setImage) or the blank whiteboard
 * tile. The texture tracks the dataURL it currently shows so the scene
 * reconcile only repaints on change.
 */

import * as THREE from 'three';

export const STICKER_TEX_SIZE = 256;

export class StickerTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** dataURL currently on the canvas (null = blank base) */
  applied: string | null = null;
  private pending = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STICKER_TEX_SIZE;
    this.canvas.height = STICKER_TEX_SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = 8;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.drawBlank();
  }

  private drawBlank(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#efece4';
    c.fillRect(0, 0, STICKER_TEX_SIZE, STICKER_TEX_SIZE);
    c.strokeStyle = 'rgba(23,21,18,0.10)';
    c.lineWidth = 5;
    c.strokeRect(2.5, 2.5, STICKER_TEX_SIZE - 5, STICKER_TEX_SIZE - 5);
    this.texture.needsUpdate = true;
  }

  /**
   * Apply a tile image (dataURL). Async decode; no-ops if the same dataURL
   * is already shown. `null` resets to the blank tile.
   */
  setImage(dataUrl: string | null): void {
    if (dataUrl === this.applied || dataUrl === this.pending) return;
    if (dataUrl === null) {
      this.pending = '';
      this.applied = null;
      this.drawBlank();
      return;
    }
    this.pending = dataUrl;
    const img = new Image();
    img.onload = () => {
      if (this.pending !== dataUrl) return; // superseded
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, STICKER_TEX_SIZE, STICKER_TEX_SIZE);
      c.drawImage(img, 0, 0, STICKER_TEX_SIZE, STICKER_TEX_SIZE);
      this.applied = dataUrl;
      this.texture.needsUpdate = true;
    };
    img.src = dataUrl;
  }

  /** direct pixel access for exports */
  get sourceCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
