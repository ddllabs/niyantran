/**
 * Search in the document (docs/specs/2026-10-02-viewer-continuous.md, section 4): folding a query
 * as search_document_pages does, finding it on a drawn page's text layer, stepping through the
 * database's matches, and the debounced, cancellable runner. Pure functions, tested in node.
 */

/** A query shorter than this, once folded, is not searched. */
export const MIN_QUERY = 2;
/** The database's limit on the query, in characters. */
const MAX_QUERY = 200;
/** The search starts this long after typing stops. */
export const SEARCH_DEBOUNCE_MS = 250;
/** The database returns at most this many pages. */
export const MAX_RESULT_PAGES = 200;
/** A snippet runs this far either side of its first match, unless the page ends first. */
const SNIPPET_REACH = 60;

/** Spacing and the Markdown marks the database folds into one space (`[\s#*_|`]`). */
const FOLDED = /[\s#*_|`]/u;

/** The query as the database folds it: Markdown marks and spacing as one space, trimmed, lower case. */
export function foldQuery(raw) {
  const folded = String(raw ?? '').normalize('NFC').replace(/[\s#*_|`]+/gu, ' ').trim().slice(0, MAX_QUERY).toLowerCase();
  return [...folded].length >= MIN_QUERY ? folded : '';
}

/**
 * Every occurrence of the folded `query` in a page's text layer (pdf.js items: `{str, hasEOL}`),
 * as `{startItem, startOffset, endItem, endOffset}` (an end offset is exclusive). The layer is
 * folded as the database folds page text: a line end or a run of spacing and Markdown marks is
 * one space; items on one line join as they are. Occurrences do not overlap, as the database
 * counts them.
 */
export function layerMatches(items, query) {
  if (!query || !Array.isArray(items) || !items.length) return [];
  let text = '';
  const at = []; // for each folded character: [item, start offset, end offset]
  const space = (item, offset) => {
    if (text && !text.endsWith(' ')) {
      text += ' ';
      at.push([item, offset, offset]);
    }
  };
  items.forEach((entry, item) => {
    const str = typeof entry?.str === 'string' ? entry.str.normalize('NFC') : '';
    let offset = 0;
    for (const char of str) {
      if (FOLDED.test(char)) space(item, offset);
      else {
        for (const lower of char.toLowerCase()) {
          text += lower;
          at.push([item, offset, offset + char.length]);
        }
      }
      offset += char.length;
    }
    if (entry?.hasEOL) space(item, offset);
  });
  const found = [];
  for (let from = text.indexOf(query); from !== -1; from = text.indexOf(query, from + query.length)) {
    const first = at[from];
    const last = at[from + query.length - 1];
    found.push({ startItem: first[0], startOffset: first[1], endItem: last[0], endOffset: last[2] });
  }
  return found;
}

/** Every match the database counted, in page order, as `{page, index}` (its index on that page). */
export function matchList(pages) {
  const list = [];
  for (const { page, hits } of pages ?? []) for (let index = 0; index < hits; index += 1) list.push({ page, index });
  return list;
}

/** Where stepping starts: the first match on or after the reader's page, else the first; -1 for none. */
export function startMatch(list, page) {
  if (!list.length) return -1;
  const at = list.findIndex(m => m.page >= page);
  return at === -1 ? 0 : at;
}

/** The match after (`direction` 1) or before (-1) `current`, wrapping; -1 when there are none. */
export function stepMatch(total, current, direction) {
  if (!total) return -1;
  return (((current + direction) % total) + total) % total;
}

/**
 * Whether the current match is only in the page's recognised text: its drawn page reported, for
 * this query, fewer matches on its text layer than the match's index needs (a scanned page, or the
 * OCR text and the PDF's own text disagree). Not while the page is undrawn or its count unknown.
 */
export function recognisedOnly({ match, query, layer }) {
  return Boolean(match && layer && layer.query === query && layer.count !== null && layer.count <= match.index);
}

/** The counter: "3 of 9", or the empty, waiting and failed states. */
export function matchLabel({ status, total, current, capped = false }) {
  if (status === 'loading') return 'Searching…';
  if (status === 'error') return "Couldn't search";
  if (status !== 'ok') return '';
  if (!total) return 'No matches';
  return `${current + 1} of ${total}${capped ? '+' : ''}`;
}

/** Whether the database cut a snippet before its start and after its end (it cuts mid-word). */
export function snippetEdges(snippet, query) {
  const first = snippet.toLowerCase().indexOf(query);
  if (first === -1) return { cutStart: false, cutEnd: false };
  return { cutStart: first >= SNIPPET_REACH, cutEnd: snippet.length - (first + query.length) >= SNIPPET_REACH };
}

/**
 * A snippet as text and match parts, for the Results list: a word the database cut at either edge
 * is dropped for an ellipsis, unless dropping it would reach a match.
 */
export function snippetParts(snippet, query, { cutStart, cutEnd }) {
  let text = snippet;
  const lower = () => text.toLowerCase();
  let lead = '';
  let tail = '';
  if (cutStart) {
    const space = text.indexOf(' ');
    if (space !== -1 && space < lower().indexOf(query)) {
      text = text.slice(space + 1);
      lead = '…';
    }
  }
  if (cutEnd) {
    const space = text.lastIndexOf(' ');
    const lastMatch = lower().lastIndexOf(query);
    if (space !== -1 && space >= lastMatch + query.length) {
      text = text.slice(0, space);
      tail = '…';
    }
  }
  const parts = [];
  const push = (part, match) => {
    if (!part) return;
    const previous = parts.at(-1);
    if (previous && !previous.match && !match) previous.text += part;
    else parts.push({ text: part, match });
  };
  push(lead, false);
  let from = 0;
  const folded = lower();
  for (let at = folded.indexOf(query); at !== -1 && query; at = folded.indexOf(query, at + query.length)) {
    push(text.slice(from, at), false);
    push(text.slice(at, at + query.length), true);
    from = at + query.length;
  }
  push(text.slice(from), false);
  push(tail, false);
  return parts;
}

/**
 * Runs `search({query, signal})` once typing settles: a new query cancels the wait and aborts a
 * search in flight, so a superseded answer is never reported. A query too short to search is
 * reported at once as idle. `onResult` gets `{query, status, pages}`.
 */
export function createSearchRunner({ search, onResult, delay = SEARCH_DEBOUNCE_MS }) {
  let timer = null;
  let abort = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    abort?.abort();
    abort = null;
  };
  return {
    run(raw) {
      cancel();
      const query = foldQuery(raw);
      if (!query) {
        onResult({ query: '', status: 'idle', pages: [] });
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        const controller = new AbortController();
        abort = controller;
        Promise.resolve(search({ query, signal: controller.signal })).then((result) => {
          if (controller.signal.aborted || result?.status === 'aborted') return;
          abort = null;
          onResult({ query, status: result?.status === 'ok' ? 'ok' : 'error', pages: result?.status === 'ok' ? result.pages : [] });
        }, () => {
          if (!controller.signal.aborted) onResult({ query, status: 'error', pages: [] });
        });
      }, delay);
    },
    cancel,
  };
}
