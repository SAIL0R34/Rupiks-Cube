/** HelpOverlay — the cheatsheet (? or the help button) */

import { useEffect, useState } from 'react';

const KEYS: Array<[string, string]> = [
  ['drag a row / column', 'twist that layer — middle rows work too'],
  ['drag empty space', 'orbit the cube (wheel zooms)'],
  ['◀ ▶ ▲ ▼ (left edge)', 'rotate the view with buttons · ⌂ resets it'],
  ['U D L R F B', 'twist that face (+⇧ for the other way)'],
  ['M E S', 'twist the middle slices'],
  ['Space', 'scramble'],
  ['Enter', 'solve back to your pictures'],
  ['⌘Z / ⇧⌘Z', 'undo / redo'],
  ['more ▾', 'swap a face picture, save/load, export'],
];

export function HelpOverlay(): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button className="help-btn" onClick={() => setOpen((v) => !v)} aria-label="help">
        ?
      </button>
      {open && (
        <div className="help-overlay" onClick={() => setOpen(false)}>
          <div className="help-card" onClick={(e) => e.stopPropagation()}>
            <h2>Rupiks Cube</h2>
            <p>
              Six of your pictures, one on each face. Twist the layers and the images
              shatter across the cube — solve it to put them back together.
            </p>
            <table>
              <tbody>
                {KEYS.map(([k, v]) => (
                  <tr key={k}>
                    <td className="key">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">click anywhere to close</p>
          </div>
        </div>
      )}
    </>
  );
}
