/** HelpOverlay — the keymap cheatsheet (? or the help button) */

import { useEffect, useState } from 'react';

const KEYS: Array<[string, string]> = [
  ['1–6 / [ ]', 'select turn face (K1)'],
  ['space / ⇧space', 'turn face CW / CCW (K2)'],
  ['X', 'double turn'],
  ['arrows', 'move cursor (K3/K4) — ⇧ coarse, ⌥ fine'],
  ['M', 'manual (experienced) mode'],
  ['D', 'pen down / up (in manual mode)'],
  ['E', 'erase mode'],
  ['A / ⇧A', 'cycle drawing face'],
  ['L', 'look at drawing face'],
  ['U', 'upload an image to etch'],
  ['Esc', 'stop the etch (partial art is kept)'],
  ['+ / −', 'etch speed'],
  ['C / 0', 'clear face / shake the cube clean'],
  ['⌘Z / ⇧⌘Z', 'undo / redo'],
  ['drag', 'orbit the cube'],
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
            <h2>TwistDraw Cube</h2>
            <p>
              Upload a photo — the machine etches it onto a face as one continuous line.
              Scramble the cube and the artwork fragments across the tiles; solve to
              reassemble it.
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
