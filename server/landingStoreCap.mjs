// F404: the stored copy of a module can hold more entries than its table lists (the table reads one page of
// STORE_PAGE_ROWS). The landing counts what the table lists, as the table does, and says so when the store
// holds more, in `capped` and `storeTotal` and in the limitations text.
// Only a table that fills its page is cut by it. One that lists fewer than a page (Cabinet: 93 of 98) was
// shortened by the module's own row filter, which is not a cap, so it is left alone. The page's raw item
// count is not on `raw` (raw.rows is already filtered), and shown <= filtered rows <= page items <= the
// page size, so shown >= STORE_PAGE_ROWS implies the page was full. (A full page the filter also trimmed is not noted; no module is known to do both.)
import { STORE_PAGE_ROWS } from './feedServe.mjs';

const inIndia = (value) => value.toLocaleString('en-IN');

export function withStoreCap(summary, raw) {
  const total = Number(raw?.storeTotal);
  const shown = summary?.count;
  if (raw?.served !== 'store' || !Number.isInteger(shown) || !Number.isFinite(total) || total <= shown || shown < STORE_PAGE_ROWS) return summary;
  const note = `The table lists the first ${inIndia(shown)} of ${inIndia(total)} stored entries; the count is of those listed.`;
  return { ...summary, capped: true, storeTotal: total, limitations: [summary.limitations, note].filter(Boolean).join(' ') };
}
