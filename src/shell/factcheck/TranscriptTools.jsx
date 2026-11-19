// B2: search, Copy and Download for the transcript text the panel already has in memory. No request is made.
// useTranscriptTools holds the phrase; TranscriptBar draws the three controls; HighlightedText marks the matching
// text of a line. Confirmations go to the view's one shared status node (announce.jsx) through `say`.
// Styles: factCheck.css (fc-tsearch, fc-mark).
import { useRef, useState } from 'react';
import {
  buildTranscriptText, copyToClipboard, downloadTextFile, highlightParts, matchLines, transcriptFileName,
} from './transcriptTools.js';

export const TRANSCRIPT_TEXT = {
  searchLabel: 'Search the transcript',
  partSearchLabel: "Search this part's transcript",
  placeholder: 'Search the transcript',
  copied: 'Transcript copied.',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  downloaded: 'Transcript downloaded.',
  downloadFailed: 'Could not make the file. Copy the text instead.',
  noMatch: 'No line matches',
};

/**
 * `lines` are { key, time?, text }; the hook returns the lines to show for the typed phrase and the actions.
 * `date` is the day of the transcript (an ISO string or a Date); the day of pressing Download when not given.
 * `say` writes to the view's shared status node.
 */
export function useTranscriptTools({ lines, title = '', date = null, say = () => {} }) {
  const [query, setQuery] = useState('');
  const shown = matchLines(lines, query);
  const noMatch = lines.length > 0 && shown.length === 0;
  return {
    query, setQuery, shown, noMatch,
    async copy() {
      const ok = await copyToClipboard(buildTranscriptText({ lines, header: false }));
      say(ok ? TRANSCRIPT_TEXT.copied : TRANSCRIPT_TEXT.copyFailed);
    },
    download() {
      const day = date ?? new Date();
      const text = buildTranscriptText({ title, date: day, lines });
      say(downloadTextFile(transcriptFileName({ title, date: day }), text) ? TRANSCRIPT_TEXT.downloaded : TRANSCRIPT_TEXT.downloadFailed);
    },
  };
}

/** The text of a line with the matching part marked; the text as it is when nothing matches. */
export function HighlightedText({ text, query }) {
  const parts = highlightParts(text, query);
  if (parts.length === 1 && !parts[0].hit) return parts[0].text;
  return parts.map((p, i) => (p.hit ? <mark className="fc-mark" key={i}>{p.text}</mark> : p.text));
}

/**
 * The search box, Copy and Download. The live transcript is the one `role="search"` landmark; a stored part
 * (`landmark={false}`) is a plain labelled group, so a long list of parts does not fill the landmark list.
 */
export function TranscriptBar({ tools, total, landmark = true, label = TRANSCRIPT_TEXT.searchLabel }) {
  const { query, setQuery, shown } = tools;
  const searching = query.trim() !== '';
  const input = useRef(null);
  // Clear disappears when pressed, which would drop focus to the page: the search box takes it.
  const clear = () => { setQuery(''); input.current?.focus(); };
  const frame = landmark ? { role: 'search' } : { role: 'group' };
  return (
    <div className="fc-tsearch" {...frame} aria-label={label}>
      <div className="fc-tsearch-row">
        <input
          type="search" className="fc-tsearch-input" dir="auto" autoComplete="off" spellCheck={false} ref={input}
          aria-label={label} placeholder={TRANSCRIPT_TEXT.placeholder} value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); clear(); } }}
        />
        {searching ? <button type="button" className="ltv-action-btn fc-btn" data-fc="tsearch-clear" onClick={clear}>Clear</button> : null}
        <button type="button" className="ltv-action-btn fc-btn" data-fc="tcopy" onClick={tools.copy}>Copy</button>
        <button type="button" className="ltv-action-btn fc-btn" data-fc="tdownload" onClick={tools.download}>Download</button>
      </div>
      {searching ? <p className="fc-tsearch-count" data-fc="tsearch-count">{`${shown.length} of ${total} lines`}</p> : null}
    </div>
  );
}
