/** A temporary exact-record view; the underlying result controls stay mounted. */
export default function RecordFocus({ focus, feature, onReturn }) {
  if (!focus) return null;
  const row = focus.row;
  const title = [row?.bill_name, row?.title, row?.subject, row?.name, row?.question].find(value => typeof value === 'string' && value.trim()) || 'Selected record';
  const fields = row ? Object.entries(row).filter(([key, value]) => !key.startsWith('_') && ['string', 'number'].includes(typeof value) && String(value).trim()).slice(0, 12) : [];
  return <section className="workspace-record-focus" aria-label="Selected search record">
    <header><h2>{row ? title : 'Record unavailable'}</h2><button type="button" onClick={onReturn}>Return to results</button></header>
    <p>{feature} · {row ? 'Opened from search or citations. Your table search and filters are preserved.' : 'This record could not be found in the current source. Your search results are still available.'}</p>
    {row && <dl>{fields.map(([key, value]) => <div key={key} style={{ display: 'contents' }}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>}
  </section>;
}
