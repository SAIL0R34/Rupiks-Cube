/**
 * Dev-only orientation markers (?debug=markers).
 *
 * Two layers, each exercising a different half of the 2D convention:
 *  1. FACE-space glyphs: a big asymmetric "L" per face, run through the real
 *     stroke splitter (faceToTile math path) as ordinary strokes.
 *  2. TILE-space marks: a static corner triangle stamped directly on every
 *     sticker texture in tile-local coords (render path).
 *
 * If the math and render conventions ever diverged (the classic mirrored-art
 * bug), the L fragments and the corner triangles would disagree after turns.
 */

import type { CubeState } from '../core/cubeState';
import type { CubeViewHandles } from './CubeView';
import { splitPolylineOnFace } from '../core/strokeSplitter';
import { FACES } from '../core/faces';
import type { Stroke } from '../core/stickers';

export function stampDevMarkers(state: CubeState, handles: CubeViewHandles): void {
  // layer 1: face-space L glyphs through the splitter
  for (const face of FACES) {
    const glyph = [
      0.35, 2.65, 0.35, 0.35, 2.65, 0.35, // L: down stroke, then right
    ];
    const subs = splitPolylineOnFace(state, face, glyph, { weight: 1, travel: false });
    for (const sub of subs) {
      const sticker = findSticker(state, sub.stickerId);
      const stroke: Stroke = {
        id: sub.strokeId,
        pts: sub.pts,
        weight: 0.9,
        travel: false,
      };
      sticker.strokes.push(stroke);
      handles.stickerTextures.get(sub.stickerId)?.appendStroke(stroke);
    }
  }
  // layer 2: static tile-local corner marks on every texture
  for (const tex of handles.stickerTextures.values()) {
    tex.drawDevCornerMark();
  }
}

function findSticker(state: CubeState, stickerId: number) {
  for (const c of state.cubies) {
    for (const s of c.stickers) if (s.id === stickerId) return s;
  }
  throw new Error(`sticker ${stickerId} not found`);
}
