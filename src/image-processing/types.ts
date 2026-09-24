/** Shared geometry of a planned etch: ordered polylines in normalized screen space. */
export interface EtchPolyline {
  /** interleaved x0,y0,x1,y1,... in [0,1] screen space */
  pts: Float32Array;
  /** true for movement strokes between features (drawn faint) */
  travel: boolean;
  /** drawing pressure / darkness 0..1 */
  weight: number;
  closed?: boolean;
}

export interface EtchPlan {
  polys: EtchPolyline[];
  /** total drawn length in normalized units, for animation pacing */
  totalLength: number;
}

export type Complexity = 'minimal' | 'standard' | 'obsessed';

export interface ProcessOptions {
  mode: Complexity;
}

export interface ProcessResponse {
  type: 'done' | 'progress' | 'error';
  plan?: EtchPlan;
  stage?: string;
  value?: number;
  message?: string;
}
