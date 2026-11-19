// B2: search, Copy and Download for the transcript text the panel already has in memory. No request is made.
// useTranscriptTools holds the phrase and the short message; TranscriptBar draws the three controls;
// HighlightedText marks the matching text of a line. Styles: factCheck.css (fc-tsearch, fc-mark).
import { useEffect, useRef, useState } from 'react';
import {
  buildTranscriptText, copyToClipboard, downloadTextFile, highlightParts, matchLines, transcriptFileName,
} from './transcriptTools.js';

export const TRANSCRIPT_TEXT = {
  searchLabel: 'Search the transcript',
  placeholder: 'Search the transcript',
  copied: 'Transcript copied.',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  downloaded: 'Transcript downloaded.',
  downloadFailed: 'Could not make the file. Copy the text instead.',
  noMatch: 'No line matches',
};
const NOTE_MS = 4000;

/**
 * `lines` are { key, time?, text }; the hook returns the lines to show for the typed phrase and the actions.
 * `date` is the day of the transcript (an ISO string or a Date); the day of pressing Download when not given.
 */
export function useTranscriptTools({ lines, title = '', date = null }) {
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (message) => {
    clearTimeout(timer.current);
    setNote(message);
    timer.current = setTimeout(() => setNote(''), NOTE_MS);
  };
  const shown = matchLines(lines, query);
  const noMatch = lines.length > 0 && shown.length === 0;
  return {
    query, setQuery, shown, noMatch, note,
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

/** The search box, Copy and Download, and the one polite status line (the count, or the short message). */
export function TranscriptBar({ tools, total }) {
  const { query, setQuery, shown, note } = tools;
  const searching = query.trim() !== '';
  return (
    <div className="fc-tsearch" role="search">
      <div className="fc-tsearch-row">
        <input
          type="search" className="fc-tsearch-input" dir="auto" autoComplete="off" spellCheck={false}
          aria-label={TRANSCRIPT_TEXT.searchLabel} placeholder={TRANSCRIPT_TEXT.placeholder} value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }}
        />
        {searching ? <button type="button" className="ltv-action-btn fc-btn" data-fc="tsearch-clear" onClick={() => setQuery('')}>Clear</button> : null}
        <button type="button" className="ltv-action-btn fc-btn" data-fc="tcopy" onClick={tools.copy}>Copy</button>
        <button type="button" className="ltv-action-btn fc-btn" data-fc="tdownload" onClick={tools.download}>Download</button>
      </div>
      {searching ? <p className="fc-tsearch-count" data-fc="tsearch-count">{`${shown.length} of ${total} lines`}</p> : null}
      <p className="fc-tsearch-note" role="status">{note}</p>
    </div>
  );
}
