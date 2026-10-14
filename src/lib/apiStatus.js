import registry from '../data/source-registry.json';

// F169 T10: a row's status comes only from asking its module (refreshFeeds.js checkOutcome). The
// hand-written status list and the "any news search is live" rule are gone.
export const STATUS = {
  live: { id: 'live', label: 'Live', copy: 'The source answered with rows' },
  archive: { id: 'archive', label: 'Stored', copy: 'Showing stored records, not live ones' },
  local: { id: 'local', label: 'Local pack', copy: 'Live URL not used · local data showing' },
  inactive: { id: 'inactive', label: 'Inactive', copy: 'No rows showing' },
  unchecked: { id: 'unchecked', label: 'Not checked', copy: 'Not checked yet; run a sweep' },
};

function rowsOf(entry) {
  const n = Number(entry.embeddedRows);
  return Number.isFinite(n) ? n : 0;
}

export function classifyApis() {
  return registry.map((entry) => ({
    key: entry.key,
    desk: entry.desk,
    feature: entry.htmlFeature,
    htmlTier: entry.htmlTier,
    adapter: entry.adapter,
    source: entry.source,
    url: entry.primaryFeedUrl || '',
    rows: rowsOf(entry),
    implementation: entry.implementationState,
    access: entry.access,
    refreshMinutes: entry.refreshMinutes,
    status: STATUS.unchecked.id,
    statusLabel: STATUS.unchecked.label,
    note: 'Not checked yet.',
  }));
}

export function apiStats(rows = classifyApis()) {
  const counts = { live: 0, archive: 0, local: 0, inactive: 0, unchecked: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { total: rows.length, ...counts };
}
