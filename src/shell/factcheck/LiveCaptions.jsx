// F416: the newest transcribed words as captions on the player, two lines at most, subtitle style (liveTv.css).
// The text is bottom-aligned in a clipped box, so older words fall off the top and the last words stay visible.
// Hidden from screen readers and click-through: the Transcript tab is the accessible text, and the player
// controls under the captions stay usable.

export function LiveCaptions({ lines, listening, raised = false }) {
  const text = lines.slice(-2).map((l) => l.text).join(' ').trim();
  if (!text && !listening) return null;
  return (
    <div className={`ltv-captions${raised ? ' is-raised' : ''}`} aria-hidden="true">
      <p className={`ltv-captions-text${text ? '' : ' is-listening'}`} dir="auto">{text || 'Listening…'}</p>
    </div>
  );
}
