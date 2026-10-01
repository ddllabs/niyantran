import { useEffect, useRef, useState } from 'react';
import { Banner, ConfirmBar, DocumentTags, POLL_MS } from './common.jsx';
import { RecordPicker } from './records.jsx';
import { RECORDS_PAGE, actionOutcome, actionPlan, anyProcessing, runAction, unlinkedActions } from './model.js';

// "Documents without a record" (Amendment A, Objective 4): standalone uploads, unlinked
// documents, orphaned links and replacements waiting to swap, with Link, Delete and Swap.

function notesOf(doc) {
  const notes = [];
  if (doc.orphaned_key) notes.push(`orphaned link: ${doc.orphaned_key}`);
  if (doc.link_target) notes.push(`replacement for ${doc.link_target}`);
  if (doc.replaces) notes.push(`replaces ${doc.replaces}`);
  return notes;
}

export function UnlinkedTable({ documents, busyId, confirm, picking, renderPicker, onAsk, onLink, onConfirm, onKeep }) {
  if (!documents.length) return <p className="adm-hint">Every ingestion-v2 document of this desk is linked to a record.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>State</th>
            <th>Link</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const allowed = unlinkedActions(doc);
            const busy = busyId === doc.document_id;
            const notes = notesOf(doc);
            let controls;
            if (confirm?.doc?.document_id === doc.document_id) {
              controls = <ConfirmBar confirm={confirm} busy={busy} onConfirm={onConfirm} onKeep={onKeep} />;
            } else if (picking?.document_id === doc.document_id) {
              controls = renderPicker(doc);
            } else {
              controls = (
                <div className="adm-actions" style={{ marginTop: 0 }}>
                  {allowed.link ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onLink(doc)}>Link</button> : null}
                  {allowed.swap ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onAsk({ kind: 'swap', doc })}>Swap</button> : null}
                  {allowed.delete ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onAsk({ kind: 'delete', doc })}>Delete</button> : null}
                </div>
              );
            }
            return (
              <tr key={doc.document_id} data-doc={doc.document_id}>
                <td>
                  <span className="feat">{doc.title || doc.document_id}</span>
                  <div className="note">{doc.source_key}</div>
                </td>
                <td><DocumentTags doc={doc} /></td>
                <td className="note">{notes.length ? notes.map((n) => <div key={n}>{n}</div>) : 'no record'}</td>
                <td>{controls}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The "Documents without a record" card's body for one desk. */
export function UnlinkedSection({ api, desk, reloadToken = 0, onChanged }) {
  const { tier, feature } = desk;
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
    api.unlinked({ desk_tier: tier, desk_feature: feature, limit: RECORDS_PAGE })
      .then((res) => { if (current) setData(res); })
      .catch((error) => { if (current) setBanner(error.message || String(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, tier, feature, reloadToken, tick]);

  const documents = data?.documents ?? [];
  const processing = anyProcessing([], documents);
  useEffect(() => {
    if (!processing) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, [processing]);

  async function run(state) {
    setBusyId(state.doc.document_id);
    const { method, request } = actionPlan(state);
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
      <Banner text={banner} />
      {loading && !data ? <p className="adm-hint">Loading documents…</p> : (
        <UnlinkedTable
          documents={documents}
          busyId={busyId}
          confirm={confirm}
          picking={picking}
          renderPicker={(doc) => (
            <RecordPicker
              api={api}
              desk={desk}
              excludeKey={doc.orphaned_key}
              onPick={(target) => { setPicking(null); setConfirm({ kind: 'link', doc, target }); }}
              onCancel={() => setPicking(null)}
            />
          )}
          onAsk={(state) => { setPicking(null); setConfirm(state); }}
          onLink={(doc) => { setConfirm(null); setPicking(doc); }}
          onConfirm={(state) => { void run(state); }}
          onKeep={() => setConfirm(null)}
        />
      )}
      {data && data.total > documents.length ? <p className="adm-hint">{`Showing ${documents.length} of ${data.total}.`}</p> : null}
    </>
  );
}
