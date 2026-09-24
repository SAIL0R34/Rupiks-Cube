/**
 * Knob — draggable rotary control (SVG), three behavior modes:
 *
 *  - `detent`: N snapped positions (K1 face selector). Click a tick to jump.
 *  - `crank`:  free continuous rotation; emits one `onQuarter(dir)` per
 *             accumulated 90° in the current direction (K2 turn crank).
 *  - `geared`: position 0..1 mapped across `revolutions` full turns
 *             (K3/K4 cursor knobs: 3 revs = one face traversal).
 *
 * Drag math: pointer capture; angle from atan2 around the knob center; deltas
 * unwrapped by clamping |Δ| ≤ π per event to kill the ±π seam.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface KnobProps {
  mode: 'detent' | 'crank' | 'geared';
  label: string;
  size?: number;
  /** detent */
  steps?: number;
  index?: number;
  labels?: string[];
  onIndex?: (i: number) => void;
  /** crank */
  onQuarter?: (dir: 1 | -1) => void;
  /** geared */
  position?: number; // 0..1
  revolutions?: number;
  onPosition?: (p: number) => void;
  disabled?: boolean;
  flashing?: boolean;
}

const TAU = Math.PI * 2;

export function Knob(props: KnobProps): JSX.Element {
  const {
    mode,
    label,
    size = 96,
    steps = 6,
    index = 0,
    labels,
    onIndex,
    onQuarter,
    position = 0,
    revolutions = 3,
    onPosition,
    disabled = false,
    flashing = false,
  } = props;

  const ref = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ lastAngle: number; accum: number; active: boolean }>({
    lastAngle: 0,
    accum: 0,
    active: false,
  });
  const [dragging, setDragging] = useState(false);
  const [visualAngle, setVisualAngle] = useState<number | null>(null); // while dragging

  const angleFromEvent = useCallback((e: PointerEvent | React.PointerEvent): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { lastAngle: angleFromEvent(e), accum: 0, active: true };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      const a = angleFromEvent(e);
      let delta = a - d.lastAngle;
      if (delta > Math.PI) delta -= TAU;
      if (delta < -Math.PI) delta += TAU;
      d.lastAngle = a;
      setVisualAngle((prev) => (prev ?? baseAngle()) + delta);

      switch (mode) {
        case 'crank': {
          d.accum += delta;
          const threshold = Math.PI / 2;
          while (Math.abs(d.accum) >= threshold) {
            const dir: 1 | -1 = d.accum > 0 ? 1 : -1;
            d.accum -= dir * threshold;
            onQuarter?.(dir);
          }
          break;
        }
        case 'geared': {
          const next = clamp01(position + delta / (TAU * revolutions));
          if (next !== position) onPosition?.(next);
          break;
        }
        case 'detent': {
          // absolute mapping: pointer angle around the dial → index
          const span = (270 * Math.PI) / 180;
          let rel = a + Math.PI / 2; // 0 = straight up
          if (rel > Math.PI) rel -= TAU;
          if (rel < -Math.PI) rel += TAU;
          const clamped = Math.max(-span / 2, Math.min(span / 2, rel));
          const i = clampInt(Math.round(((clamped + span / 2) / span) * (steps - 1)), 0, steps - 1);
          if (i !== index) onIndex?.(i);
          break;
        }
      }
    };
    const onUp = () => {
      dragRef.current.active = false;
      setDragging(false);
      setVisualAngle(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, position, index, mode, steps, revolutions]);

  const baseAngle = (): number => {
    if (mode === 'detent') {
      const span = (270 * Math.PI) / 180;
      return -span / 2 + (index / (steps - 1)) * span;
    }
    if (mode === 'geared') {
      return ((position * revolutions) % 1) * TAU;
    }
    return 0; // crank: free rotation, no persistent angle
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (mode === 'detent') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        onIndex?.(clampInt(index + 1, 0, steps - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        onIndex?.(clampInt(index - 1, 0, steps - 1));
      }
    } else if (mode === 'geared') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        onPosition?.(clamp01(position + 0.02));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        onPosition?.(clamp01(position - 0.02));
      }
    } else if (mode === 'crank') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        onQuarter?.(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        onQuarter?.(-1);
      }
    }
  };

  const angle =
    dragging && mode !== 'detent' ? (visualAngle ?? baseAngle()) : baseAngle();
  const r = size / 2;
  const cx = r;
  const cy = r;
  const knobR = r - 10;
  const ticks =
    mode === 'detent'
      ? Array.from({ length: steps }, (_, i) => {
          const span = (270 * Math.PI) / 180;
          return -span / 2 + (i / (steps - 1)) * span;
        })
      : Array.from({ length: 12 }, (_, i) => (i / 12) * TAU);

  return (
    <div className={`knob ${disabled ? 'disabled' : ''} ${flashing ? 'flashing' : ''}`}>
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuenow={mode === 'detent' ? index : Math.round(position * 100)}
        aria-valuetext={
          mode === 'detent' && labels ? labels[index] : `${Math.round(position * 100)}%`
        }
      >
        <circle cx={cx} cy={cy} r={knobR + 5} className="knob-halo" />
        <circle cx={cx} cy={cy} r={knobR} className="knob-body" />
        {ticks.map((a, i) => {
          const tx = cx + Math.cos(a) * (knobR + 2);
          const ty = cy + Math.sin(a) * (knobR + 2);
          const ix = cx + Math.cos(a) * (knobR - 6);
          const iy = cy + Math.sin(a) * (knobR - 6);
          const active = mode === 'detent' && i === index;
          return (
            <line
              key={i}
              x1={ix}
              y1={iy}
              x2={tx}
              y2={ty}
              className={`knob-tick ${active ? 'active' : ''}`}
            />
          );
        })}
        <g transform={`rotate(${(angle * 180) / Math.PI} ${cx} ${cy})`}>
          <line x1={cx} y1={cy - knobR * 0.2} x2={cx} y2={cy - knobR * 0.85} className="knob-stem" />
          <circle cx={cx} cy={cy} r={knobR * 0.12} className="knob-hub" />
        </g>
      </svg>
      <div className="knob-label">{label}</div>
      {mode === 'detent' && labels && <div className="knob-value">{labels[index ?? 0]}</div>}
    </div>
  );
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampInt(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
