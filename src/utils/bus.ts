/**
 * Tiny typed event bus for cross-cutting commands (camera tweens, upload
 * requests, plot aborts) that shouldn't thread through the store.
 */

export type BusEvents = {
  'camera-look': { face: 'U' | 'D' | 'L' | 'R' | 'F' | 'B' };
  /** orbit the view by deltas (radians, spherical) without touching the cube */
  'camera-orbit': { dTheta: number; dPhi: number };
  /** reset the view to the default pose */
  'camera-reset': {};
  'upload-request': {};
  'abort-plot': {};
  'celebrate': {};
};

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

const handlers: { [K in keyof BusEvents]?: Set<Handler<K>> } = {};

export function on<K extends keyof BusEvents>(event: K, fn: Handler<K>): () => void {
  let set = handlers[event] as Set<Handler<K>> | undefined;
  if (!set) {
    set = new Set();
    handlers[event] = set as never;
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  const set = handlers[event] as Set<Handler<K>> | undefined;
  if (!set) return;
  for (const fn of [...set]) fn(payload);
}
