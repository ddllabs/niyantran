// F416: the newest transcribed words as captions on the player, two lines at most, subtitle style (liveTv.css).
// The text is bottom-aligned in a clipped box, so older words fall off the top and the last words stay visible.
// Hidden from screen readers and click-through: the Transcript tab is the accessible text, and the player
// controls under the captions stay usable.

// Seconds of silence after which the panel says it is not hearing anything (the same 30 s as the panel's own
// notice in FactCheckPanel.jsx); the page uses it to decide whether the captions pulse "Listening…".
export const SILENT_NOTICE_MS = 30000;

export function LiveCaptions({ lines, listening }) {
  const text = lines.slice(-2).map((l) => l.text).join(' ').trim();
  if (!text && !listening) return null;
  return (
    <div className="ltv-captions" aria-hidden="true">
      <p className={`ltv-captions-text${text ? '' : ' is-listening'}`} dir="auto">{text || 'Listening…'}</p>
    </div>
  );
}
