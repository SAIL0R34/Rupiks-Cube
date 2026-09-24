/**
 * Typed client for the vendored image processor worker.
 * Handles worker lifecycle, stale-generation drops, and progress callbacks.
 */

import type { Complexity, EtchPlan } from '../image-processing/types';

export interface ProcessorProgress {
  stage: string;
  value: number;
}

export class ProcessorClient {
  private worker: Worker;
  private generation = 0;

  constructor() {
    this.worker = new Worker(new URL('./imageProcessor.worker.ts', import.meta.url), {
      type: 'module',
    });
  }

  /**
   * Process an image. Resolves with the plan, or rejects on error. If a newer
   * request supersedes this one, the older promise never settles (stale
   * `done`/`error` messages are dropped by generation check).
   */
  process(
    imageData: ImageData,
    mode: Complexity,
    onProgress: (p: ProcessorProgress) => void,
  ): Promise<EtchPlan> {
    const gen = ++this.generation;
    return new Promise<EtchPlan>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        if (gen !== this.generation) {
          cleanup();
          return; // superseded
        }
        const { type, plan, stage, value, message } = e.data ?? {};
        if (type === 'progress') {
          onProgress({ stage: stage ?? '', value: value ?? 0 });
        } else if (type === 'done') {
          cleanup();
          resolve(plan as EtchPlan);
        } else if (type === 'error') {
          cleanup();
          reject(new Error(String(message)));
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(new Error(e.message || 'worker failed'));
      };
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.postMessage({ imageData, mode });
    });
  }

  dispose(): void {
    this.generation++;
    this.worker.terminate();
  }
}
