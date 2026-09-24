/// <reference lib="webworker" />
import { processImageData } from '../image-processing/pipeline';
import type { Complexity } from '../image-processing/types';

interface Req {
  imageData: ImageData;
  mode: Complexity;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { imageData, mode } = e.data;
  try {
    const plan = processImageData(imageData, mode, (stage, value) => {
      (self as unknown as Worker).postMessage({ type: 'progress', stage, value });
    });
    (self as unknown as Worker).postMessage({ type: 'done', plan });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
  }
};
