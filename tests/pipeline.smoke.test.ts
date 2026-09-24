import { describe, expect, it } from 'vitest';
import { processImageData } from '../src/image-processing/pipeline';
import type { EtchPlan } from '../src/image-processing/types';

/**
 * Pins the vendored pipeline contract (SAIL0R34/etch-a-sketch) so upstream
 * drift is caught: takes a plain ImageData-shaped buffer, returns an EtchPlan
 * of polylines in [0,1] normalized space.
 */

/** black square with a white border on a white canvas — guaranteed edges */
function syntheticImage(size = 320): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inSquare = x > size * 0.25 && x < size * 0.75 && y > size * 0.25 && y < size * 0.75;
      const v = inSquare ? 30 : 235;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size } as unknown as ImageData;
}

describe('vendored etch pipeline', () => {
  it('produces a plan with at least one polyline for a synthetic edge image', () => {
    const progress: Array<{ stage: string; value: number }> = [];
    const plan: EtchPlan = processImageData(syntheticImage(), 'minimal', (stage, value) => {
      progress.push({ stage, value });
    });

    expect(plan).toBeTruthy();
    expect(plan.polys.length).toBeGreaterThanOrEqual(1);
    expect(plan.totalLength).toBeGreaterThan(0);

    for (const poly of plan.polys) {
      expect(poly.pts.length).toBeGreaterThanOrEqual(4); // at least 2 points
      expect(poly.pts.length % 2).toBe(0); // interleaved x/y
      for (let i = 0; i < poly.pts.length; i++) {
        expect(poly.pts[i]).toBeGreaterThanOrEqual(-0.01);
        expect(poly.pts[i]).toBeLessThanOrEqual(1.01);
      }
      expect(typeof poly.travel).toBe('boolean');
      expect(poly.weight).toBeGreaterThanOrEqual(0);
      expect(poly.weight).toBeLessThanOrEqual(1);
    }
  });

  it('reports monotonic-ish progress stages', () => {
    const values: number[] = [];
    processImageData(syntheticImage(160), 'minimal', (_stage, value) => {
      values.push(value);
    });
    expect(values.length).toBeGreaterThan(0);
    // progress never goes backwards by more than a hair
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 0.001);
    }
  });
});
