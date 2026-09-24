# TwistDraw Cube

A Rubik's cube made of *your* pictures. Put a photo on each of the six faces,
twist the layers, and watch the images shatter across the 54 tiles — then
solve the cube to put them back together.

## How it plays

1. **Pick six pictures** — the first screen is a face picker laid out like the
   unfolded cube. One photo per face, or "use one picture everywhere."
2. **Twist by hand** — drag any row or column of the cube directly. The layer
   follows your finger and snaps into place when you let go. Middle rows work
   too (M/E/S slices).
3. **Scramble & solve** — `scramble` shatters the pictures; `solve` walks the
   cube back to the exact state your photos were placed in. Undo/redo works
   across scrambles, per twist.

Controls: drag a row/column = twist · drag empty space = orbit (wheel zooms) ·
`U D L R F B` (+⇧) twist faces · `M E S` middle slices · `Space` scramble ·
`Enter` solve · `⌘Z`/`⇧⌘Z` undo/redo · `?` help · `more ▾` for swapping a
face picture, save/load, exports, start over.

Closing the tab mid-puzzle is safe — the full session (cube, pictures, undo
history) autosaves and restores on return.

## Persistence & exports

- **Session autosave** — automatic pause/resume via localStorage.
- **Save file** — shareable JSON snapshot of the puzzle.
- **Exports** — unfolded cross-net as PNG or SVG (built from the *current*
  tile distribution, so a scrambled cube exports scrambled), plus a PNG of
  the current view.

## Architecture

```
src/
  core/        pure cube engine (no DOM, no three) — 100% test-covered
               rotation group · FACE_FRAME · 27 moves (incl. slices) ·
               face↔tile transforms · history · scramble · serialization v2
  imaging/     square compose + faceBlit (corner-affine image→tile mapping)
  three/       SceneManager (SKETCHY-style cream/light rig), CubeView
               (26 cubies + 54 sticker CanvasTextures), TurnAnimator,
               TwistGesture (raycast drag-to-twist)
  store/       Zustand single source of truth + localStorage session store
  ui/          Onboarding, ControlPanel (primary bar + drawer), Help
  net/         cross-net PNG/SVG export from current tiles
tests/         property gates P1–P9
```

Key invariants, enforced by tests:

- **Integer-exact orientation** — interned 24-element rotation group; zero
  drift over thousands of moves.
- **P5** — face↔tile coordinate round-trips hold for every cell of every face
  across scrambled orientations (one `FACE_FRAME` table feeds math *and*
  renderer — the mirrored-art bug killer).
- **P7** — random command walks (twists + image paints + references) undo
  back to the exact initial state, including paints undone across later
  scrambles.
- Image orientation is verified end-to-end in the browser: an asymmetric
  marker image must land upright on its face, deterministically (pixel-level
  probes on both the tile canvas and the WebGL framebuffer).

## Development

```bash
npm install
npm run dev        # vite dev server
npm test           # vitest (core property gates)
npm run build      # type-check + production build
```

## History

v1 was an etch-a-sketch line-drawing cube (image → continuous-line sketch,
vendored from [SAIL0R34/etch-a-sketch](https://github.com/SAIL0R34/etch-a-sketch)).
It was refactored to the photo cube per product direction — the etch mode
lives in git history. The visual language (cream paper, warm light rig)
still follows that repo's aesthetic.
