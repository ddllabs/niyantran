export const PAGE_COUNT = 18;
export const CITED_PAGE = 12;
export const PASSAGE_LINES = [
  'The copper heron keeps the archive open after sunset.',
  'Every numbered ledger records a separate verified observation.',
  'This unique passage ends at the violet boundary marker.',
];
export const PASSAGE = PASSAGE_LINES.join('\n');
export const DOCUMENT_ID = 'local-viewer-regression';
export const EXTRACT_HASH = 'local-extract-v1';
export const INACCURATE_BOX = { page: CITED_PAGE, x0: 0.1, y0: 0.08, x1: 0.85, y1: 0.13 };
export const PAGE_LINES = Array.from({ length: PAGE_COUNT }, (_, index) => {
  const page = index + 1;
  const lines = [`Local regression document - page ${page}`, 'Searchable archive: a deterministic local record.'];
  for (let line = 0; line < 28; line++) {
    lines.push(page === CITED_PAGE && line >= 15 && line < 18
      ? PASSAGE_LINES[line - 15]
      : `Page ${page}, line ${line + 1}: ordinary archive material for scrolling.`);
  }
  return lines;
});
let offset = 0;
export const PAGE_ROWS = PAGE_LINES.map((lines, index) => {
  const text = lines.join('\n');
  const row = { page_number: index + 1, text, char_from: offset, char_to: offset + text.length, width_px: 612, height_px: 792 };
  offset += text.length + 1;
  return row;
});
