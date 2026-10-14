/**
 * A multi-choice filter's selected values and whether a row's value passes it. Moved here from
 * TableFilterPop.jsx (F156) so the server's paged answers filter exactly as the browser does;
 * TableFilterPop.jsx re-exports both.
 */
export function selectedValues(current, allValue = '') {
  if (Array.isArray(current)) return current;
  if (current == null || current === '' || current === allValue || current === 'all' || current === 'All') return [];
  return [current];
}

export function matchesChoice(current, value, allValue = '') {
  const sel = selectedValues(current, allValue);
  if (!sel.length) return true;
  return sel.map(String).includes(String(value));
}
