/**
 * SceneManager — renderer, camera, mouse-only orbit, resize, rAF loop.
 * Owns no authoritative cube state; per-frame work happens in update hooks.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private container: HTMLElement;
  private raf = 0;
  private updateHooks: Array<(dt: number, t: number) => void> = [];
  private lastTime = 0;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101014');

    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(5.4, 4.2, 6.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 16;
    this.controls.rotateSpeed = 0.9;

    // lighting: key + fill + rim, soft
    const key = new THREE.DirectionalLight(0xfff2e0, 1.15);
    key.position.set(5, 8, 6);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
    fill.position.set(-6, 2, -4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(0, -5, -8);
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.38));

    this.controls.update();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  onUpdate(fn: (dt: number, t: number) => void): void {
    this.updateHooks.push(fn);
  }

  private loop(time: number): void {
    if (this.disposed) return;
    const dt = this.lastTime === 0 ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    this.controls.update();
    for (const hook of this.updateHooks) hook(dt, time / 1000);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
