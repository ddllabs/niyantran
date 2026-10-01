import { useEffect, useRef, useState } from 'react';
import { Banner, ConfirmBar, DocumentTags, POLL_MS, SEARCH_MS, useDebounced } from './common.jsx';
import {
  LEGACY_WARNING,
  STATUS_CHIPS,
  STATUS_LABEL,
  STATUS_PILL,
  actionOutcome,
  actionPlan,
  anyProcessing,
  coverageLine,
  deskChoices,
  documentActions,
  pageInfo,
  pickerChoices,
  recordActions,
  recordTitle,
  recordsRequest,
  runAction,
  sharedRowsNote,
} from './model.js';

// The Records view (Amendment A, Objective 1): one row per record key of a keyed desk, with its
// status, the rows sharing it, the documents holding it, and the actions each allows.

const PICKER_LIMIT = 10;

export function DeskPicker({ value, pairs, onChange, disabled = false }) {
  const { keyed, aliases, keyless } = deskChoices(pairs);
  return (
    <label className="adm-field span2">
      <span>Desk</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Desks with records">
          {keyed.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          {aliases.map((c) => <option key={c.value} value={c.value}>{`${c.label} — ${c.note}`}</option>)}
        </optgroup>
        <optgroup label="No record keys yet — standalone uploads only">
          {keyless.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

export function CoverageLine({ coverage }) {
  const text = coverageLine(coverage);
  return text ? <p className="adm-hint" style={{ marginTop: 0 }}>{text}</p> : null;
}

export function StatusChips({ status, onChange }) {
  return (
    <>
      {STATUS_CHIPS.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className={`adm-chip${status === chip.id ? ' on' : ''}`}
          aria-pressed={status === chip.id}
          onClick={() => onChange(chip.id)}
        >
          {chip.label}
        </button>
      ))}
    </>
  );
}

export function Pager({ total, page, busy = false, onPage }) {
  const info = pageInfo(total, page);
  return (
    <div className="adm-actions">
      <button className="adm-btn tiny ghost" type="button" disabled={busy || !info.hasPrev} onClick={() => onPage(page - 1)}>Prev</button>
      <span className="note">{info.text}</span>
      <button className="adm-btn tiny ghost" type="button" disabled={busy || !info.hasNext} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

const sameDoc = (state, record, doc) => Boolean(state) && state.doc?.document_id === doc.document_id
  && state.record?.document_key === record.document_key;

function RecordDocument({ record, doc, busyId, confirm, picking, renderPicker, onReplace, onAsk, onRelink, onConfirm, onKeep }) {
  const allowed = documentActions(doc);
  const busy = busyId === doc.document_id;
  let controls = null;
  if (sameDoc(confirm, record, doc)) {
    controls = <ConfirmBar confirm={confirm} busy={busy} onConfirm={onConfirm} onKeep={onKeep} />;
  } else if (sameDoc(picking, record, doc)) {
    controls = renderPicker(record, doc);
  } else if (allowed.replace || allowed.delete) {
    controls = (
      <div className="adm-actions" style={{ marginTop: 4 }}>
        {allowed.replace ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onReplace(record, doc)}>Replace</button> : null}
        {allowed.unlink ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onAsk({ kind: 'unlink', record, doc })}>Unlink</button> : null}
        {allowed.relink ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onRelink(record, doc)}>Re-link</button> : null}
        {allowed.delete ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onAsk({ kind: 'delete', record, doc })}>Delete</button> : null}
      </div>
    );
  }
  return (
    <div className="adm-recdoc" data-doc={doc.document_id}>
      <span className="feat">{doc.title || doc.document_id}</span>
      {' '}
      <DocumentTags doc={doc} />
      {controls}
    </div>
  );
}

export function RecordsTable({ records, busyId, uploading = false, confirm, picking, renderPicker, onAttach, onReplace, onAsk, onRelink, onConfirm, onKeep }) {
  if (!records.length) return <p className="adm-hint">No records match.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Record</th>
            <th>Status</th>
            <th>Documents</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const { attach, legacyWarning } = recordActions(record);
            const shared = sharedRowsNote(record);
            const date = record.rows?.[0]?.date;
            return (
              <tr key={record.document_key} data-record={record.document_key}>
                <td>
                  <span className="feat">{recordTitle(record)}</span>
                  <div className="note">{date ? `${record.document_key} · ${date}` : record.document_key}</div>
                  {shared ? <div className="note" title={shared.title}>{shared.text}</div> : null}
                </td>
                <td><span className={`adm-pill ${STATUS_PILL[record.status] ?? 'archive'}`}>{STATUS_LABEL[record.status] ?? record.status}</span></td>
                <td>
                  {record.documents.length ? record.documents.map((doc) => (
                    <RecordDocument
                      key={doc.document_id}
                      record={record}
                      doc={doc}
                      busyId={busyId}
                      confirm={confirm}
                      picking={picking}
                      renderPicker={renderPicker}
                      onReplace={onReplace}
                      onAsk={onAsk}
                      onRelink={onRelink}
                      onConfirm={onConfirm}
                      onKeep={onKeep}
                    />
                  )) : <span className="note">No documents</span>}
                </td>
                <td>
                  {attach ? (
                    <>
                      <button className="adm-btn tiny" type="button" disabled={uploading} onClick={() => onAttach(record)}>Attach PDF</button>
                      {legacyWarning ? <div className="note">{LEGACY_WARNING}</div> : null}
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A search over the desk's records, for choosing where to link or re-link a document. */
export function RecordPicker({ api, desk, excludeKey, onPick, onCancel }) {
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim(), SEARCH_MS);
  const [found, setFound] = useState({ query: '', records: null, error: '' });
  const { tier, feature } = desk;

  useEffect(() => {
    if (!query) return undefined;
    let alive = true;
    api.records({ desk_tier: tier, desk_feature: feature, query, limit: PICKER_LIMIT })
      .then((res) => { if (alive) setFound({ query, records: res?.records ?? [], error: '' }); })
      .catch((error) => { if (alive) setFound({ query, records: null, error: error.message || String(error) }); });
    return () => { alive = false; };
  }, [api, tier, feature, query]);

  const current = query && found.query === query;
  const choices = current && found.records ? pickerChoices(found.records, excludeKey) : [];
  return (
    <div className="adm-picker">
      <input className="adm-search" value={input} placeholder="Bill title or number" aria-label="Search for the record to link to" onChange={(e) => setInput(e.target.value)} />
      {current && found.error ? <p className="adm-msg err" role="alert">{found.error}</p> : null}
      {current && found.records && !choices.length ? <p className="note">No other record matches.</p> : null}
      {choices.length ? (
        <ul className="adm-picker-list">
          {choices.map((r) => (
            <li key={r.document_key}>
              <button className="adm-btn tiny ghost" type="button" onClick={() => onPick(r)}>{`${r.document_key} — ${recordTitle(r)}`}</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="adm-actions" style={{ marginTop: 4 }}>
        <button className="adm-btn tiny ghost" type="button" onClick={() => onCancel()}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * The Records card's body for a keyed desk: search, status chips, the table, paging, and the
 * per-record actions. `reloadToken` changes whenever the page wants every list re-read;
 * `onChanged` asks the page for that after an action (or a stale refusal).
 */
export function RecordsSection({ api, desk, reloadToken = 0, uploading = false, onChanged, onAttach, onReplace }) {
  const { tier, feature } = desk;
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim(), SEARCH_MS);
  const [status, setStatus] = useState('all');
  const filterKey = `${tier}|${feature}\u0000${query}\u0000${status}`;
  const [paging, setPaging] = useState({ filterKey, page: 0 });
  const page = paging.filterKey === filterKey ? paging.page : 0;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [picking, setPicking] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.records(recordsRequest({ desk: { tier, feature }, query, status, page }))
      .then((res) => { if (current) setData(res); })
      .catch((error) => { if (current) setBanner(error.message || String(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, tier, feature, query, status, page, reloadToken, tick]);

  const records = data?.records ?? [];
  const processing = anyProcessing(records);
  useEffect(() => {
    if (!processing) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, [processing]);

  async function run(state) {
    const { method, request } = actionPlan(state);
    setBusyId(state.doc.document_id);
    const outcome = actionOutcome(await runAction(api, method, request));
    if (!alive.current) return;
    setBusyId(null);
    setConfirm(null);
    setPicking(null);
    setBanner(outcome.banner);
    if (outcome.reload) {
      if (onChanged) onChanged();
      else setTick((t) => t + 1);
    }
  }

  return (
    <>
      {desk.alias ? <p className="adm-hint" style={{ marginTop: 0 }}>Policy Intelligence Graph holds the same records as Bill Passage Probability Index; they are shown here.</p> : null}
      <CoverageLine coverage={data?.coverage} />
      <div className="adm-filters">
        <input className="adm-search" value={input} placeholder="Search bills by title or number" aria-label="Search records" onChange={(e) => setInput(e.target.value)} />
        <StatusChips status={status} onChange={(next) => setStatus(next)} />
      </div>
      <Banner text={banner} />
      {loading && !data ? <p className="adm-hint">Loading records…</p> : (
        <RecordsTable
          records={records}
          busyId={busyId}
          uploading={uploading}
          confirm={confirm}
          picking={picking}
          renderPicker={(record, doc) => (
            <RecordPicker
              api={api}
              desk={desk}
              excludeKey={record.document_key}
              onPick={(target) => { setPicking(null); setConfirm({ kind: 'relink', record, doc, target }); }}
              onCancel={() => setPicking(null)}
            />
          )}
          onAttach={onAttach}
          onReplace={onReplace}
          onAsk={(state) => { setPicking(null); setConfirm(state); }}
          onRelink={(record, doc) => { setConfirm(null); setPicking({ record, doc }); }}
          onConfirm={(state) => { void run(state); }}
          onKeep={() => setConfirm(null)}
        />
      )}
      {data ? <Pager total={data.total} page={page} busy={loading} onPage={(next) => setPaging({ filterKey, page: next })} /> : null}
    </>
  );
}
