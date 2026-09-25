/**
 * The free starter pack — twelve public-domain artworks (from Wikimedia
 * Commons; see CREDITS in the README) offered alongside the user's own
 * pictures. The cube always starts blank; these are an optional shortcut.
 */

export interface DemoImage {
  file: string;
  title: string;
  artist: string;
}

export const DEMO_IMAGES: readonly DemoImage[] = [
  { file: '/demo/great-wave.jpg', title: 'The Great Wave off Kanagawa', artist: 'Katsushika Hokusai' },
  { file: '/demo/red-fuji.jpg', title: 'South Wind, Clear Dawn (Red Fuji)', artist: 'Katsushika Hokusai' },
  { file: '/demo/starry-night.jpg', title: 'The Starry Night', artist: 'Vincent van Gogh' },
  { file: '/demo/the-scream.jpg', title: 'The Scream', artist: 'Edvard Munch' },
  { file: '/demo/mona-lisa.jpg', title: 'Mona Lisa', artist: 'Leonardo da Vinci' },
  { file: '/demo/pearl-earring.jpg', title: 'Girl with a Pearl Earring', artist: 'Johannes Vermeer' },
  { file: '/demo/milkmaid.jpg', title: 'The Milkmaid', artist: 'Johannes Vermeer' },
  { file: '/demo/wanderer-fog.jpg', title: 'Wanderer above the Sea of Fog', artist: 'Caspar David Friedrich' },
  { file: '/demo/impression-sunrise.jpg', title: 'Impression, Sunrise', artist: 'Claude Monet' },
  { file: '/demo/the-kiss.jpg', title: 'The Kiss', artist: 'Gustav Klimt' },
  { file: '/demo/night-watch.jpg', title: 'The Night Watch', artist: 'Rembrandt van Rijn' },
  { file: '/demo/birth-of-venus.jpg', title: 'The Birth of Venus', artist: 'Sandro Botticelli' },
];

/** n distinct random picks from the pack */
export function samplePack(n: number): DemoImage[] {
  const pool = [...DEMO_IMAGES];
  const out: DemoImage[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}
