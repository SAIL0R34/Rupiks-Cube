/**
 * planMapper — EtchPlan [0,1]² → active-face (u,v) ∈ [0,3]².
 *
 * The vendored pipeline stretches the full frame to [0,1]² and expects the
 * caller to have pre-composed the image to the target aspect (the upload step
 * does that on a square canvas). A small margin keeps ink off the face border
 * and the outer tile seams read cleanly.
 */

import type { EtchPlan } from '../image-processing/types';

export interface MappedPlan {
  /** polylines in face coords (u,v interleaved), one per etch polyline */
  polys: Array<{ pts: number[]; travel: boolean; weight: number; closed?: boolean }>;
  totalLength: number;
}

const MARGIN = 0.06;

export function mapPlanToFace(plan: EtchPlan, faceSize = 3, margin = MARGIN): MappedPlan {
  const span = faceSize - 2 * margin;
  const toU = (x: number) => margin + x * span;
  const toV = (y: number) => margin + y * span;
  const polys = plan.polys.map((p) => {
    const pts: number[] = new Array(p.pts.length);
    for (let i = 0; i < p.pts.length; i += 2) {
      pts[i] = toU(p.pts[i]);
      pts[i + 1] = toV(p.pts[i + 1]);
    }
    return {
      pts,
      travel: p.travel,
      weight: p.weight,
      ...(p.closed ? { closed: true } : {}),
    };
  });
  return { polys, totalLength: plan.totalLength * span };
}
