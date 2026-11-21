// F404: the stored copy of a module can hold more entries than its table lists (the table reads one page of
// STORE_PAGE_ROWS). The landing counts what the table lists, as the table does, and says so when the store
// holds more, in `capped` and `storeTotal` and in the limitations text.
const inIndia = (value) => value.toLocaleString('en-IN');

export function withStoreCap(summary, raw) {
  const total = Number(raw?.storeTotal);
  const shown = summary?.count;
  if (raw?.served !== 'store' || !Number.isInteger(shown) || !Number.isFinite(total) || total <= shown) return summary;
  const note = `The table lists the first ${inIndia(shown)} of ${inIndia(total)} stored entries; the count is of those listed.`;
  return { ...summary, capped: true, storeTotal: total, limitations: [summary.limitations, note].filter(Boolean).join(' ') };
}
