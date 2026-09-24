# TwistDraw Cube

A Rubik's cube you draw on — then scramble and solve to reassemble your art.

Upload a photo and the machine etches it onto a cube face as one continuous
etch-a-sketch style line. Twist layers and the artwork fragments across the
54 tiles; solve the cube and the drawing snaps back together.

This app is the **digital reference implementation** for the TwistDraw Cube
concept — the state model a physical hand-twist + e-paper toy would follow.

## The idea

- Every cubie face is a persistent drawing tile.
- Artwork lives in **tile-local space welded to its cubie**: when a layer
  turns, strokes ride along and rotate with the cubie. Fragmentation is not an
  effect — it falls out of the geometry.
- "Solving" = restoring the cube to the reference state captured when the
  artwork was finished. The app replays the exact inverse of every move made
  since, so **any** drawing is reassemblable.

## Controls

Four knobs (bottom deck), fully mirrored on the keyboard:

| Knob | Role | Keys |
| ---- | ---- | ---- |
| K1 | turn-face selector (6 detents) | `1`–`6`, `[` `]` |
| K2 | turn crank — each 90° of cranking turns that face CW/CCW | `Space` / `⇧Space`, `X` double |
| K3 | cursor X (3 revolutions = one face) | `←` `→` |
| K4 | cursor Y | `↑` `↓` |

Everything else:

- `U` upload an image → it etches onto the drawing face (`Esc` stops; partial
  art is kept, like a real etch-a-sketch)
- `A` cycle the drawing face · `L` look at it
- `M` **experienced mode** (manual knob drawing), `D` pen down/up
- `E` erase mode (sweep the cursor over strokes)
- `C` clear face · `0` shake the whole cube clean
- `⌘Z` / `⇧⌘Z` undo / redo — works across scrambles, per stroke batch
- `+` / `−` etch speed (1–8×) · `?` full help
- drag = orbit the camera (the mouse never draws)

## Persistence

- **Session memory store** — automatic. Close the tab mid-anything and come
  back: cube, art, undo history, and even an interrupted etch are restored
  (you'll get a *resume plotting* prompt).
- **Save file** — a shareable JSON snapshot of the artwork (load it on any
  machine).
- **Exports** — unfolded cross-net as true-vector SVG or PNG, plus a PNG of
  the current view.

## Architecture

```
src/
  core/        pure cube engine (no DOM, no three) — 100% test-covered
               rotation group · FACE_FRAME · moves · transforms · splitter
               history (undo semantics) · scramble · serialization
  three/       SceneManager, CubeView (26 cubies + 54 sticker CanvasTextures),
               TurnAnimator (pivot tween; commits via the store)
  plotting/    worker client, plan mapper, PlotSession (constant-speed etch)
  image-processing/ + workers/   VENDORED from SAIL0R34/etch-a-sketch (MIT)
  store/       Zustand single source of truth + localStorage session store
  ui/          Knob (detent/crank/geared), panels, keymap, help
  net/         cross-net SVG/PNG export
tests/         property tests (P1–P9 gates)
```

Key invariants, enforced by tests:

- **Integer-exact orientation** — cubie orientations are interned members of
  the 24-element rotation group; thousands of moves accumulate zero drift.
- **P5** — face↔tile coordinate round-trips hold for every cell of every face
  across hundreds of scrambled orientations (this is the mirrored-art bug
  killer: one `FACE_FRAME` table feeds both the math and the renderer).
- **P3** — strokes are conserved across 1000-move scrambles: never lost,
  duplicated, or mutated; they only migrate.
- **P7** — random command walks undo back to the exact initial state,
  including stroke batches undone across later scrambles.

## Development

```bash
npm install
npm run dev        # vite dev server
npm test           # vitest (core property gates)
npm run build      # type-check + production build
```

Add `?debug` to the dev URL to stamp orientation markers on every tile
(face-space glyphs through the real splitter vs. static tile-space marks) for
visual verification of the 2D conventions.

## Credits

The image → etch-line pipeline (`src/image-processing/`, `src/workers/`) is
vendored from [SAIL0R34/etch-a-sketch](https://github.com/SAIL0R34/etch-a-sketch)
(MIT) — see `THIRD_PARTY_NOTICES.md`. Everything else is original to
TwistDraw Cube.
