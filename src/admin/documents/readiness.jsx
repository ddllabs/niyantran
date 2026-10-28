import { useEffect, useRef, useState } from 'react';

export function readinessRequest(desk, kind, exactId = '', cohort = '', cursor = null) {
  if (kind === 'records' && cohort.trim()) throw new Error('Cohort review decisions filter documents only.');
  return { desk_tier: desk.tier, desk_feature: desk.feature, limit: 50,
    ...(exactId.trim() ? { ids: [exactId.trim()] } : {}),
    ...(cohort.trim() ? { cohort: cohort.trim() } : {}), ...(cursor ? { cursor } : {}) };
}
export function inspectPage(api, kind, request) {
  return kind === 'records' ? api.readinessRecords(request) : api.readinessDocuments(request);
}
export function createReadinessLoader() {
  let sequence = 0;
  return { invalidate() { sequence++; }, async run(read) {
    const current = ++sequence;
    try { const answer = await read(); return { current: current === sequence, answer }; }
    catch (error) { return { current: current === sequence, error }; }
  } };
}
const value = v => v === true ? 'yes' : v === false ? 'no' : v ?? 'unknown';
function DocumentDetails({ doc }) {
  return <div><code>{doc.document_id}</code><p>{doc.title}</p>
    <p>Index: {doc.index_state} · Association: {doc.association_kind} · Publication: {doc.publication_state}</p>
    <p>Chunks examined: {doc.chunks_scanned ?? 0} · Vectors present: {doc.vectors_scanned ?? 0}{doc.inspection_limited ? ' · Inspection limit reached' : ''}</p>
    {doc.role ? <p>Role: {doc.role} · Version: {doc.version} · Identity valid: {value(doc.identity_ok)} · Published link: {value(doc.published)}</p> : null}
    {doc.job ? <p>Job: {doc.job.status} / {doc.job.stage}{doc.job.error_code ? ` · ${doc.job.error_code}` : ''}</p> : null}
    {doc.cohort ? <p>Review decision: {doc.cohort}</p> : null}
  </div>;
}
export function ReadinessTable({ kind, items }) {
  if (!items.length) return <p className="adm-hint">No matching entities in this page. This does not establish that source text is absent.</p>;
  return <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Identity</th><th>Administrative diagnostics</th></tr></thead><tbody>
    {items.map(item => <tr key={kind === 'records' ? item.row_key : item.document_id}>
      <td><code>{kind === 'records' ? item.row_key : item.document_id}</code>{kind === 'records' ? <p>{item.title}</p> : null}</td>
      <td>{kind === 'documents' ? <DocumentDetails doc={item} /> : <>
        <p>State: {item.state} · Adapter: {item.association_adapter} · Ready documents examined: {item.ready_documents}</p>
        {item.links_limited ? <p>Association inspection limit reached; remaining sources are unknown.</p> : null}
        {item.documents.map(doc => <DocumentDetails key={doc.document_id} doc={doc} />)}
      </>}</td>
    </tr>)}
  </tbody></table></div>;
}
/** Read-only, user-triggered pages; no polling, mutation controls or legacy-key inference. */
export function ReadinessSection({ api, desk }) {
  const [kind, setKind] = useState('records');
  const [id, setId] = useState(''); const [cohort, setCohort] = useState('');
  const [page, setPage] = useState(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const loader = useRef(null);
  if (!loader.current) loader.current = createReadinessLoader();
  useEffect(() => { const current = loader.current; return () => current.invalidate(); }, []);
  const [applied, setApplied] = useState(null);
  function invalidate() { loader.current.invalidate(); setPage(null); setApplied(null); setError(''); setBusy(false); }
  async function load(event, next = false) {
    event?.preventDefault(); setBusy(true); setError('');
    let q;
    try { q = next ? { ...applied, cursor: page.next_cursor } : readinessRequest(desk, kind, id, cohort); }
    catch (e) { setError(e.message); setBusy(false); return; }
    const result = await loader.current.run(() => inspectPage(api, kind, q));
    if (!result.current) return;
    setBusy(false);
    if (result.error) { setError(result.error.message); setPage(null); }
    else { setPage(result.answer); setApplied(q); }
  }
  function reset(nextKind) { invalidate(); setKind(nextKind); setId('');setCohort(''); }
  return <div className="adm-card"><h2>Corpus readiness — read only</h2>
    <p className="adm-hint">Privileged administrative diagnostics. These results do not establish ordinary-user access or approve ingestion, mappings or publication. Each page examines at most 100 documents and 1,001 chunk probes per document; limited inspections remain unknown. Unassociated documents may be intentional standalone uploads or require association review.</p>
    <form className="adm-form" onSubmit={load}>
      <label className="adm-field"><span>Inspect</span><select value={kind} onChange={e => reset(e.target.value)}><option value="records">Records</option><option value="documents">Documents</option></select></label>
      <label className="adm-field"><span>{kind === 'records' ? 'Exact row key (optional)' : 'Exact document UUID (optional)'}</span><input value={id} maxLength={1024} onChange={e => {invalidate();setId(e.target.value);}} /></label>
      {kind === 'documents' ? <label className="adm-field"><span>Exact cohort review decision (optional)</span><input value={cohort} maxLength={300} onChange={e => {invalidate();setCohort(e.target.value);}} /></label> : null}
      <div className="adm-actions"><button className="adm-btn tiny" type="submit" disabled={busy}>{busy ? 'Inspecting…' : 'Inspect first 50'}</button></div>
    </form>
    {error ? <p role="alert">{error} Readiness is unknown; no absence conclusion is available.</p> : null}
    {page ? <><p className="adm-hint">Observed: {page.observed_at} · {page.items.length} entities on this page · No whole-corpus total. Pages reflect their own observation time.</p>
      <ReadinessTable kind={kind} items={page.items} />
      {page.has_more ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={e => load(e,true)}>Next page</button> : null}</> : null}
  </div>;
}
