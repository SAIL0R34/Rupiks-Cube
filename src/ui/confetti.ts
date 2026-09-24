/**
 * Confetti — a lightweight 2D particle burst on a fixed overlay canvas.
 * Fired via the 'celebrate' bus event; self-removes when the last piece lands.
 */

const COLORS = ['#a81c12', '#d8492f', '#e8b04b', '#3e7a52', '#171512', '#fdfcf9', '#7fa8d9'];
const PIECES = 160;
const LIFETIME = 2600; // ms

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  w: number;
  h: number;
  color: string;
  born: number;
  wobble: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let pieces: Piece[] = [];
let raf = 0;

export function burstConfetti(): void {
  if (typeof document === 'undefined') return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }
  if (!ctx) return;
  resize();
  const w = canvas.width;
  const h = canvas.height;
  const now = performance.now();
  for (let i = 0; i < PIECES; i++) {
    const fromCenter = i % 2 === 0;
    const x = fromCenter ? w / 2 + (Math.random() - 0.5) * w * 0.25 : Math.random() * w;
    const y = fromCenter ? h * 0.3 : -20 - Math.random() * h * 0.25;
    const angle = fromCenter ? (Math.random() - 0.5) * Math.PI : Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    const speed = (fromCenter ? 350 : 90) + Math.random() * 220;
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (fromCenter ? 260 : 0),
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 14,
      w: 6 + Math.random() * 7,
      h: 9 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      born: now,
      wobble: Math.random() * Math.PI * 2,
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

function resize(): void {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick(): void {
  if (!ctx || !canvas) return;
  const now = performance.now();
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  const dt = 1 / 60;
  pieces = pieces.filter((p) => now - p.born < LIFETIME && p.y < h + 30);
  for (const p of pieces) {
    p.vy += 900 * dt; // gravity
    p.vx *= 0.995;
    p.wobble += 6 * dt;
    p.x += p.vx * dt + Math.sin(p.wobble) * 40 * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    const age = (now - p.born) / LIFETIME;
    const alpha = age > 0.75 ? Math.max(0, 1 - (age - 0.75) / 0.25) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.sin(p.wobble))));
    ctx.restore();
  }
  if (pieces.length > 0) {
    raf = requestAnimationFrame(tick);
  } else {
    raf = 0;
    ctx.clearRect(0, 0, w, h);
  }
}
