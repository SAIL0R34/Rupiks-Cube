/**
 * SceneManager — renderer, camera, mouse orbit, resize, rAF loop.
 *
 * Visual rig matched to the SKETCHY (SAIL0R34/etch-a-sketch) aesthetic:
 * transparent canvas over the cream page gradient, ACES tone mapping, a
 * PMREM room environment plus warm key / cool fill / white rim / warm bounce
 * lights, and soft shadows.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const DEFAULT_CAMERA_POS = new THREE.Vector3(5.0, 3.9, 6.2);

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** the world-space ray target for twist gestures / orbit separation */
  readonly raycaster: THREE.Raycaster;

  private container: HTMLElement;
  private raf = 0;
  private updateHooks: Array<(dt: number, t: number) => void> = [];
  private lastTime = 0;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene(); // transparent — the page gradient shows

    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    this.camera.position.copy(DEFAULT_CAMERA_POS);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5.5;
    this.controls.maxDistance = 14;
    this.controls.rotateSpeed = 0.85;
    this.controls.enabled = true; // gestures toggle this during twists

    this.raycaster = new THREE.Raycaster();

    // --- SKETCHY lighting rig ---
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    const envTex = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = envTex;
    (this.scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.55;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff4ea, 2.5);
    key.position.set(2.6, 3.4, 4.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -2.6;
    cam.right = 2.6;
    cam.top = 2.6;
    cam.bottom = -2.6;
    cam.near = 1;
    cam.far = 14;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;

    const fill = new THREE.DirectionalLight(0xd8e2ff, 0.65);
    fill.position.set(-3.4, 1.6, 2.2);
    const rim = new THREE.DirectionalLight(0xffffff, 1.35);
    rim.position.set(0.6, -1.4, -4.4);
    const bounce = new THREE.PointLight(0xffe9d2, 0.25, 8);
    bounce.position.set(0, -1.2, 2.2);
    this.scene.add(key, fill, rim, bounce);

    this.resize();
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

  // --- programmatic view motion (buttons; never touches cube state) ---------

  private orbitTween: number | null = null;

  /** tween the camera around the origin by spherical deltas (radians) */
  orbitBy(dTheta: number, dPhi: number, ms = 380): void {
    const sph = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const from = { theta: sph.theta, phi: sph.phi, radius: sph.radius };
    const to = {
      theta: from.theta + dTheta,
      phi: THREE.MathUtils.clamp(from.phi + dPhi, 0.35, Math.PI - 0.35),
      radius: from.radius,
    };
    this.runViewTween(from, to, ms);
  }

  /** tween back to the default framing pose */
  resetView(ms = 420): void {
    const defaultSph = new THREE.Spherical().setFromVector3(
      DEFAULT_CAMERA_POS.clone().sub(this.controls.target),
    );
    const sph = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    // unwrap theta so we take the short way around
    let dTheta = defaultSph.theta - sph.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.runViewTween(
      { theta: sph.theta, phi: sph.phi, radius: sph.radius },
      { theta: sph.theta + dTheta, phi: defaultSph.phi, radius: defaultSph.radius },
      ms,
    );
  }

  private runViewTween(
    from: { theta: number; phi: number; radius: number },
    to: { theta: number; phi: number; radius: number },
    ms: number,
  ): void {
    if (this.orbitTween !== null) cancelAnimationFrame(this.orbitTween);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(from.radius, to.radius, e),
        THREE.MathUtils.lerp(from.phi, to.phi, e),
        THREE.MathUtils.lerp(from.theta, to.theta, e),
      );
      this.camera.position.setFromSpherical(sph).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      if (t < 1) {
        this.orbitTween = requestAnimationFrame(step);
      } else {
        this.orbitTween = null;
      }
    };
    step();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.orbitTween !== null) cancelAnimationFrame(this.orbitTween);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
