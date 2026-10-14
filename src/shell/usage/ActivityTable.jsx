/**
 * Section C's view (F153): the "All AI activity" filters, table, expanded calls and paging. Hook-free;
 * ActivityDialog.jsx holds the state. Rows with more than one call expand through a real button; the
 * chat title opens the conversation (F149's niy-open-conversation).
 */
import { formatCredits } from '../../lib/creditsStore.js';
import {
  CREDITS_STARTED_NOTE, beforeCredits, effortLabel, indianNumber, modelName, roleLabel, rowChat, whenText,
} from '../../lib/creditUsage.js';
import { Credits, StatusPill, Tokens } from './usageParts.jsx';

export function rowKey(row, index) {
  return row.turnKey ? `t:${row.turnKey}` : `r:${row.createdAt}:${row.model}:${index}`;
}

function Switch({ label, on, onChange, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`cu-switch${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="cu-switch-track" aria-hidden="true"><span className="cu-switch-knob" /></span>
      {label}
    </button>
  );
}

function Filters({ filters, models, onFilter, onExport, exporting, disabled }) {
  return (
    <div className="cu-filters">
      <label className="cu-select">
        <span>Model</span>
        <select value={filters.model || ''} onChange={(e) => onFilter({ model: e.target.value || null })}>
          <option value="">All models</option>
          {models.map((m) => <option key={m} value={m}>{modelName(m)}</option>)}
        </select>
      </label>
      <label className="cu-select">
        <span>Status</span>
        <select value={filters.status} onChange={(e) => onFilter({ status: e.target.value })}>
          <option value="all">All</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label className="cu-select">
        <span>Kind</span>
        <select value={filters.kind} onChange={(e) => onFilter({ kind: e.target.value })}>
          <option value="all">All</option>
          <option value="answers">Answers</option>
          <option value="dictation">Dictation</option>
        </select>
      </label>
      <Switch label="Group by question" on={filters.grouped} onChange={(grouped) => onFilter({ grouped })} />
      <Switch label="Failures only" on={filters.status === 'failed'} onChange={(on) => onFilter({ status: on ? 'failed' : 'all' })} />
      <button type="button" className="cu-btn" onClick={() => onExport()} disabled={disabled || exporting}>
        {exporting ? 'Exporting…' : 'Export CSV'}
      </button>
    </div>
  );
}

/** A row that would have been charged had credits existed: before the launch, not failed, 0 credits. */
function uncharged(row) {
  return beforeCredits(row.createdAt) && !row.credits && row.status !== 'failed';
}

function CreditsCell({ row }) {
  if (uncharged(row)) {
    return <span className="cu-credits" title={CREDITS_STARTED_NOTE}><span className="cu-credits-num">0</span><span className="cu-credits-note">before credits*</span></span>;
  }
  return <Credits value={row.credits} />;
}

function Calls({ row, id }) {
  const total = row.detail.reduce((s, d) => s + d.credits, 0);
  return (
    <tr id={id} className="cu-detail">
      <td colSpan={6}>
        {row.question ? <p className="cu-question"><span className="cu-sr">Question: </span>{row.question}</p> : null}
        <table className="cu-table cu-calls">
          <caption className="cu-sr">Calls behind this answer</caption>
          <thead>
            <tr><th scope="col">Role</th><th scope="col">Model</th><th scope="col">Thinking</th><th scope="col">Tokens</th><th scope="col">Credits</th></tr>
          </thead>
          <tbody>
            {row.detail.map((d, i) => (
              <tr key={i} className={d.status === 'failed' ? 'cu-call-failed' : ''}>
                <td>{roleLabel(d.role)}{d.status !== 'succeeded' ? <span className="cu-call-status"> · {d.status}</span> : null}</td>
                <td title={d.model || ''}>{modelName(d.model)}</td>
                <td>{effortLabel(d.effort)}</td>
                <td><Tokens value={d.tokens} /></td>
                <td>{d.free ? <span className="cu-free">free</span> : formatCredits(d.credits)}</td>
              </tr>
            ))}
            <tr className="cu-total">
              <th scope="row" colSpan={3}>TOTAL</th>
              <td><Tokens value={row.tokens} /></td>
              <td>{formatCredits(row.credits || total)}</td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function Row({ row, index, expanded, onToggleRow, onOpenChat, grouped }) {
  const key = rowKey(row, index);
  const chat = rowChat(row);
  const canExpand = grouped && row.calls > 1 && row.detail.length > 0;
  const open = canExpand && expanded.has(key);
  const detailId = `cu-calls-${index}`;
  return (
    <>
      <tr className={open ? 'cu-row on' : 'cu-row'}>
        <td className="cu-when">
          {canExpand ? (
            <button type="button" className="cu-expand" aria-expanded={open} aria-controls={open ? detailId : undefined}
              aria-label={`${open ? 'Hide' : 'Show'} the ${row.calls} calls of ${chat}`} onClick={() => onToggleRow(key)}>
              <span aria-hidden="true">{open ? '▾' : '▸'}</span>
            </button>
          ) : <span className="cu-expand-gap" aria-hidden="true" />}
          {whenText(row.createdAt)}
        </td>
        <td className="cu-chat">
          {row.conversationId ? (
            <button type="button" className="cu-chat-open" title={chat} onClick={() => onOpenChat(row.conversationId)}>{chat}</button>
          ) : <span className={row.turnKey ? 'cu-chat-gone' : ''}>{chat}</span>}
          <span className="cu-chat-model" title={row.model || ''}>{row.model ? modelName(row.model) : '—'}</span>
        </td>
        <td className="cu-num">{indianNumber(row.calls)}</td>
        <td className="cu-num"><Tokens value={row.tokens} /></td>
        <td className="cu-num"><CreditsCell row={row} /></td>
        <td><StatusPill status={row.status} /></td>
      </tr>
      {open ? <Calls row={row} id={detailId} /> : null}
    </>
  );
}

export default function ActivityTable({
  state, filters, offset, pageSize, expanded, models, exporting, exportError,
  onFilter, onPage, onToggleRow, onOpenChat, onExport,
}) {
  const rows = state?.rows || [];
  const total = state?.total || 0;
  const early = rows.some(uncharged);
  return (
    <div className="cu-activity">
      <Filters filters={filters} models={models} onFilter={onFilter} onExport={onExport} exporting={exporting} disabled={!total} />
      {exportError ? <p className="cu-note cu-error" role="alert">{exportError}</p> : null}
      {state?.status === 'loading' && !rows.length ? (
        <p className="cu-note" role="status">Loading activity…</p>
      ) : state?.status === 'error' ? (
        <p className="cu-note cu-error" role="alert">Activity could not be loaded just now.</p>
      ) : !rows.length ? (
        <p className="cu-note">No AI activity matches these filters.</p>
      ) : (
        <>
          <div className="cu-table-wrap">
            <table className="cu-table cu-activity-table">
              <caption className="cu-sr">{filters.grouped ? 'AI activity, one row per question' : 'AI activity, one row per call'}</caption>
              <thead>
                <tr>
                  <th scope="col">When</th><th scope="col">Chat</th><th scope="col" className="cu-num">Calls</th>
                  <th scope="col" className="cu-num">Tokens</th><th scope="col" className="cu-num">Credits</th><th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <Row key={rowKey(row, offset + i)} row={row} index={offset + i} expanded={expanded}
                    onToggleRow={onToggleRow} onOpenChat={onOpenChat} grouped={filters.grouped} />
                ))}
              </tbody>
            </table>
          </div>
          {early ? <p className="cu-caption">* {CREDITS_STARTED_NOTE}; earlier calls show 0 credits.</p> : null}
        </>
      )}
      <div className="cu-pager">
        <span role="status">{total ? `Showing ${offset + 1}–${offset + rows.length} of ${indianNumber(total)}` : 'Showing 0 of 0'}</span>
        <button type="button" className="cu-btn" disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>Previous</button>
        <button type="button" className="cu-btn" disabled={offset + rows.length >= total} onClick={() => onPage(offset + pageSize)}>Next</button>
      </div>
    </div>
  );
}
