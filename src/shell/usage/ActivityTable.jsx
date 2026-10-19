/**
 * The Activity section's list (F153; F184 spec §3.4): the filters, one row per answer led by its
 * question, the calls behind an answer as a bar split by step, and paging. Hook-free; ActivitySection
 * holds the state. Rows with more than one call open through a real button; the chat title opens the
 * conversation (F149's niy-open-conversation). Credits only.
 */
import { formatCredits } from '../../lib/creditsStore.js';
import {
  CREDITS_STARTED_NOTE, beforeCredits, effortLabel, indianNumber, modelLabel, roleLabel, rowChat, whenText,
} from '../../lib/creditUsage.js';
import { roleSegments } from '../../lib/creditsVisual.js';
import { StatusPill, Tokens } from './usageParts.jsx';

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
        <select value={filters.model || ''} onChange={(e) => onFilter({ model: e.target.value || null })} name="activity-model">
          <option value="">All models</option>
          {models.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
        </select>
      </label>
      <label className="cu-select">
        <span>Status</span>
        <select value={filters.status} onChange={(e) => onFilter({ status: e.target.value })} name="activity-status">
          <option value="all">All</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label className="cu-select">
        <span>Kind</span>
        <select value={filters.kind} onChange={(e) => onFilter({ kind: e.target.value })} name="activity-kind">
          <option value="all">All</option>
          <option value="answers">Answers</option>
          <option value="dictation">Dictation</option>
        </select>
      </label>
      <Switch label="Group by question" on={filters.grouped && !filters.byChat} onChange={(grouped) => onFilter({ grouped })} disabled={filters.byChat} />
      <Switch label="Group by chat" on={Boolean(filters.byChat)} onChange={(byChat) => onFilter({ byChat })} />
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

const ROLE_SLOT = { search: 3, answer: 2, repair: 7, dictation: 4 };

/** One answer's credits as a bar split by step, then every call behind it. */
function Calls({ row, id }) {
  const segments = roleSegments(row.detail);
  const total = row.credits || segments.reduce((s, x) => s + x.credits, 0);
  return (
    <div id={id} className="cp-calls">
      <p className="cp-calls-title">Where {total ? `these ${formatCredits(total)} credits` : 'this answer'} went</p>
      {total > 0 ? (
        <div className="cp-bar cp-bar-role" role="img" aria-label={segments.map((s) => `${roleLabel(s.role)} ${s.free ? 'free' : formatCredits(s.credits)}`).join(', ')}>
          {segments.filter((s) => s.credits > 0).map((s) => <span key={s.role} className={`cp-seg cp-s${ROLE_SLOT[s.role] ?? 7}`} style={{ flexGrow: s.credits }} />)}
        </div>
      ) : null}
      <ul className="cp-roles">
        {segments.map((s) => (
          <li key={s.role}>
            <span className={`cp-swatch cp-s${ROLE_SLOT[s.role] ?? 7}`} aria-hidden="true" />
            <span><strong>{roleLabel(s.role)}</strong> {s.free ? <span className="cu-free">free</span> : <strong className="cp-role-num">{formatCredits(s.credits)}</strong>}
              <span className="cp-dim cp-block">{s.model ? modelLabel(s.model) : ''}{s.effort ? ` · ${effortLabel(s.effort)} thinking` : ''}{s.calls > 1 ? ` · ${s.calls} calls` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
      <table className="cu-table cu-calls">
        <caption className="cu-sr">Calls behind this answer</caption>
        <thead>
          <tr><th scope="col">Step</th><th scope="col">Model</th><th scope="col">Thinking</th><th scope="col">Tokens</th><th scope="col">Credits</th></tr>
        </thead>
        <tbody>
          {row.detail.map((d, i) => (
            <tr key={i} className={d.status === 'failed' ? 'cu-call-failed' : ''}>
              <td>{roleLabel(d.role)}{d.status !== 'succeeded' ? <span className="cu-call-status"> · {d.status}</span> : null}</td>
              <td title={d.model || ''}>{modelLabel(d.model)}</td>
              <td>{effortLabel(d.effort)}</td>
              <td><Tokens value={d.tokens} /></td>
              <td>{d.free ? <span className="cu-free">free</span> : formatCredits(d.credits)}</td>
            </tr>
          ))}
          <tr className="cu-total">
            <th scope="row" colSpan={3}>Total</th>
            <td><Tokens value={row.tokens} /></td>
            <td>{formatCredits(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, index, max, expanded, onToggleRow, onOpenChat, grouped }) {
  const key = rowKey(row, index);
  const chat = rowChat(row);
  const canExpand = grouped && row.detail.length > 0 && (row.calls > 1 || row.detail.length > 1);
  const open = canExpand && expanded.has(key);
  const detailId = `cu-calls-${index}`;
  const early = uncharged(row);
  const searches = row.detail.filter((d) => d.role === 'search').length;
  return (
    <li className={`cp-row${open ? ' on' : ''}${row.status === 'failed' ? ' cp-row-failed' : ''}`}>
      <div className="cp-row-main">
        {canExpand ? (
          <button type="button" className="cu-expand" aria-expanded={open} aria-controls={open ? detailId : undefined}
            aria-label={`${open ? 'Hide' : 'Show'} the ${row.calls} calls of ${chat}`} onClick={() => onToggleRow(key)}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        ) : <span className="cu-expand-gap" aria-hidden="true" />}
        <div className="cp-row-text">
          <p className="cp-row-q">{row.question || chat}</p>
          <p className="cp-row-meta">
            <span>{whenText(row.createdAt)}</span>
            {row.question ? (row.conversationId
              ? <button type="button" className="cu-chat-open" title={chat} onClick={() => onOpenChat(row.conversationId)}>{chat}</button>
              : <span className={row.turnKey ? 'cu-chat-gone' : ''}>{chat}</span>) : (row.conversationId
              ? <button type="button" className="cu-chat-open" onClick={() => onOpenChat(row.conversationId)}>Open chat</button> : null)}
            <span className="cp-chip" title={row.model || ''}>{row.model ? modelLabel(row.model) : 'No model'}</span>
            <span>{indianNumber(row.calls)} {row.calls === 1 ? 'call' : 'calls'} · <Tokens value={row.tokens} /> tokens{searches ? ` · ${searches} ${searches === 1 ? 'search step' : 'search steps'}` : ''}</span>
            {row.status !== 'succeeded' ? <StatusPill status={row.status} /> : null}
          </p>
        </div>
        <span className="cp-mini" aria-hidden="true"><span className="cp-s0" style={{ width: `${max > 0 ? Math.round((100 * row.credits) / max) : 0}%` }} /></span>
        <span className="cp-row-credits" title={early ? CREDITS_STARTED_NOTE : undefined}>
          {early ? <>0<span className="cu-credits-note">before credits*</span></> : formatCredits(row.credits)}
          <span className="cu-sr"> credits</span>
        </span>
      </div>
      {open ? <Calls row={row} id={detailId} /> : null}
    </li>
  );
}

/** Answers totalled per chat, from every matching answer (ActivitySection loads them). */
function ChatGroups({ groups, onOpenChat }) {
  const max = groups[0]?.credits || 0;
  return (
    <ul className="cp-rows">
      {groups.map((g) => (
        <li key={g.key} className="cp-row">
          <div className="cp-row-main">
            <span className="cu-expand-gap" aria-hidden="true" />
            <div className="cp-row-text">
              <p className="cp-row-q">{g.conversationId
                ? <button type="button" className="cu-chat-open cp-chat-title" onClick={() => onOpenChat(g.conversationId)}>{rowChat(g.sample)}</button>
                : rowChat(g.sample)}</p>
              <p className="cp-row-meta"><span>{indianNumber(g.answers)} {g.answers === 1 ? 'answer' : 'answers'} · {indianNumber(g.calls)} calls</span><span>latest {whenText(g.latest)}</span></p>
            </div>
            <span className="cp-mini" aria-hidden="true"><span className="cp-s0" style={{ width: `${max > 0 ? Math.round((100 * g.credits) / max) : 0}%` }} /></span>
            <span className="cp-row-credits">{formatCredits(g.credits)}<span className="cu-sr"> credits</span></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ActivityTable({
  state, chats = null, filters, offset, pageSize, expanded, models, exporting, exportError,
  onFilter, onPage, onToggleRow, onOpenChat, onExport,
}) {
  const rows = state?.rows || [];
  const total = state?.total || 0;
  const early = rows.some(uncharged);
  const max = Math.max(0, ...rows.map((r) => r.credits || 0));
  return (
    <div className="cu-activity">
      <Filters filters={filters} models={models} onFilter={onFilter} onExport={onExport} exporting={exporting}
        disabled={filters.byChat ? !chats?.groups?.length : !total} />
      {exportError ? <p className="cu-note cu-error" role="alert">{exportError}</p> : null}
      {filters.byChat ? (
        !chats || chats.status === 'loading' ? <p className="cu-note" role="status">Totalling your chats…</p>
          : chats.status === 'error' ? <p className="cu-note cu-error" role="alert">Chat totals could not be loaded just now.</p>
            : !chats.groups.length ? <p className="cu-note">No AI activity matches these filters.</p>
              : (
                <>
                  <p className="cu-caption">{indianNumber(chats.groups.length)} chats, most credits first{chats.capped ? ', from your latest 2,000 answers' : ''}.</p>
                  <ChatGroups groups={chats.groups} onOpenChat={onOpenChat} />
                </>
              )
      ) : state?.status === 'loading' && !rows.length ? (
        <p className="cu-note" role="status">Loading activity…</p>
      ) : state?.status === 'error' ? (
        <p className="cu-note cu-error" role="alert">Activity could not be loaded just now.</p>
      ) : !rows.length ? (
        <p className="cu-note">No AI activity matches these filters.</p>
      ) : (
        <>
          <ul className="cp-rows" aria-label={filters.grouped ? 'AI activity, one row per question' : 'AI activity, one row per call'}>
            {rows.map((row, i) => (
              <Row key={rowKey(row, offset + i)} row={row} index={offset + i} max={max} expanded={expanded}
                onToggleRow={onToggleRow} onOpenChat={onOpenChat} grouped={filters.grouped} />
            ))}
          </ul>
          {early ? <p className="cu-caption">* {CREDITS_STARTED_NOTE}; earlier calls show 0 credits.</p> : null}
        </>
      )}
      {filters.byChat ? null : (
        <div className="cu-pager">
          <span role="status">{total ? `Showing ${offset + 1}–${offset + rows.length} of ${indianNumber(total)}` : 'Showing 0 of 0'}</span>
          <button type="button" className="cu-btn" disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>Previous</button>
          <button type="button" className="cu-btn" disabled={offset + rows.length >= total} onClick={() => onPage(offset + pageSize)}>Next</button>
        </div>
      )}
    </div>
  );
}
