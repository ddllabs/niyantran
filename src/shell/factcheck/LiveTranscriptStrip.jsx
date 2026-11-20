// F389: the newest transcribed words, two lines, pinned between the block line and the scroll area while a
// session runs and the Transcript tab is not showing. The older text is clipped at the top (the box is
// bottom-aligned), so the last words are always the visible ones. Not a live region: this is a preview, and
// the Transcript tab is the accessible source. "Full transcript" hands over to the panel's tab switch.
export function LiveTranscriptStrip({ lines, listening, onOpen }) {
  const text = lines.slice(-2).map((l) => l.text).join(' ').trim();
  return (
    <div className="fc-tstrip" role="group" aria-label="Latest transcript" aria-live="off">
      <div className="fc-tstrip-text">
        {text
          ? <p className="fc-tstrip-line" dir="auto">{text}</p>
          : <p className={`fc-tstrip-line ${listening ? 'fc-listening' : 'fc-tstrip-idle'}`}>Listening…</p>}
      </div>
      <div className="fc-tstrip-side">
        <span className="fc-tstrip-label">Transcript</span>
        <button type="button" className="fc-tstrip-btn" data-fc="full-transcript" onClick={onOpen}>Full transcript</button>
      </div>
    </div>
  );
}
