/** Current-view PNG export (the renderer keeps its drawing buffer) */

import type * as THREE from 'three';
import { downloadBlob } from '../utils/download';

let renderer: THREE.WebGLRenderer | null = null;

export function registerRenderer(r: THREE.WebGLRenderer): void {
  renderer = r;
}

export function captureView(): Promise<Blob> {
  if (!renderer) return Promise.reject(new Error('renderer not ready'));
  const canvas = renderer.domElement;
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/png');
  });
}

export async function downloadView(): Promise<void> {
  downloadBlob(await captureView(), 'rupiks-view.png');
}
