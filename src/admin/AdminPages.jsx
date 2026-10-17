import { useEffect, useRef, useState } from 'react';
import { apiStats, classifyApis, STATUS } from '../lib/apiStatus.js';
import { loadUsersPage, setUserActive, setUserPlan, setUserType, USER_TYPES, userTypeOf, usersPaging } from '../lib/userStore.js';
import { adjustUserCredits, CREDIT_ACTIONS, creditRequest, formatBalance, newRequestId } from './userCredits.js';
import {
  formatAgo,
  formatDuration,
  formatWhen,
  intervalMs,
  loadRefreshCfg,
  nextSweepAt,
  refreshProgress,
  saveRefreshCfg,
  subscribeRefresh,
} from '../lib/refreshStore.js';
import { cancelSweep, decorateApis, refreshOne, sweepApis } from '../lib/refreshFeeds.js';
import FeedStoreSection from './FeedStoreSection.jsx';

const DESKS = ['ALL', 'GLOBAL', 'NATIONAL', 'STATE', 'LOCAL', 'LAW', 'ECONOMICS', 'CARBON', 'SPORTS', 'ENTERTAINMENT'];

function Pill({ status }) {
  const meta = STATUS[status] || STATUS.inactive;
  return (
    <span className={`adm-pill ${status}`}>
      <i />
      {meta.label}
    </span>
  );
}

function useRefreshTick() {
  const [, setN] = useState(0);
  useEffect(() => subscribeRefresh(() => setN((x) => x + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, []);
}

function RefreshBar({ compact }) {
  useRefreshTick();
  const cfg = loadRefreshCfg();
  const prog = refreshProgress();
  const [hours, setHours] = useState(String(cfg.intervalHours));
  const [msg, setMsg] = useState('');
  const due = nextSweepAt();
  const remaining = Math.max(0, due - Date.now());

  async function run(scope) {
    setMsg('');
    const res = await sweepApis({ scope });
    setMsg(res.ok ? `Swept ${res.count} feeds.` : res.reason);
  }

  function saveInterval(e) {
    e.preventDefault();
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0 || n > 72) {
      setMsg('Interval must be between 0.25 and 72 hours.');
      return;
    }
    saveRefreshCfg({ intervalHours: n });
    setMsg(`Live APIs will refresh every ${n} hour${n === 1 ? '' : 's'}.`);
  }

  return (
    <div className={`adm-refresh${compact ? ' compact' : ''}`}>
      <form className="adm-refresh-cfg" onSubmit={saveInterval}>
        <label className="adm-field">
          <span>Live refresh every</span>
          <span className="adm-inline">
            <input
              type="number"
              min="0.25"
              max="72"
              step="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <em>hours</em>
            <button className="adm-btn ghost" type="submit">
              Save
            </button>
          </span>
        </label>
      </form>
      <div className="adm-refresh-meta">
        <div>
          <span>Last live sweep</span>
          <b title={formatWhen(cfg.lastLiveSweep)}>{formatAgo(cfg.lastLiveSweep)}</b>
        </div>
        <div>
          <span>Next due</span>
          <b>{!cfg.lastLiveSweep ? 'awaiting first sweep' : Date.now() >= due ? 'due now' : `in ${formatDuration(remaining)}`}</b>
        </div>
        <div>
          <span>Auto</span>
          <b>{cfg.auto ? 'on' : 'off'}</b>
        </div>
      </div>
      <div className="adm-actions" style={{ margin: 0 }}>
        <button className="adm-btn" type="button" disabled={prog.running} onClick={() => run('live')}>
          {prog.running && prog.scope === 'live' ? 'Refreshing live…' : 'Refresh live'}
        </button>
        <button className="adm-btn ghost" type="button" disabled={prog.running} onClick={() => run('all')}>
          {prog.running && prog.scope === 'all' ? 'Refreshing all…' : 'Refresh all'}
        </button>
        {prog.running ? (
          <button className="adm-btn danger" type="button" onClick={() => cancelSweep()}>
            Cancel
          </button>
        ) : null}
        <button
          className="adm-btn ghost"
          type="button"
          onClick={() => saveRefreshCfg({ auto: !cfg.auto })}
        >
          Auto {cfg.auto ? 'on' : 'off'}
        </button>
      </div>
      {prog.running ? (
        <div className="adm-sweep-wrap">
          <div className="adm-sweep">
            <i style={{ width: `${prog.total ? (100 * prog.done) / prog.total : 0}%` }} />
          </div>
          <span>
            {prog.done}/{prog.total} · {prog.current || 'starting'}
          </span>
        </div>
      ) : null}
      {msg ? <p className="adm-msg">{msg}</p> : null}
    </div>
  );
}

export function OverviewPage({ users }) {
  useRefreshTick();
  // The directory is read a page at a time (F147); the total is of all of it.
  const directoryTotal = usersPaging().total;

  const rows = decorateApis(classifyApis());
  const stats = apiStats(rows);
  const total = stats.total || 1;
  const cfg = loadRefreshCfg();
  const bars = [
    ['live', stats.live, '#176b55'],
    ['archive', stats.archive, '#c4a35a'],
    ['unchecked', stats.unchecked, '#8a8f98'],
    ['local', stats.local, '#012ea1'],
    ['inactive', stats.inactive, '#c81322'],
  ];
  return (
    <>
      <h1 className="adm-h1">Control plane</h1>
      <p className="adm-lede">
        Live feeds refresh on the interval below. Archived packs, local registers, and silent desks stay labelled so a
        quiet source is never dressed up as live.
      </p>

      <RefreshBar />
      <div className="adm-kpis">
        <article className="adm-kpi live">
          <label>Live</label>
          <strong>{stats.live}</strong>
          <span>APIs returning rows</span>
        </article>
        <article className="adm-kpi archive">
          <label>Stored</label>
          <strong>{stats.archive}</strong>
          <span>Stored records showing</span>
        </article>
        <article className="adm-kpi local">
          <label>Local pack</label>
          <strong>{stats.local}</strong>
          <span>URL unused · data showing</span>
        </article>
        <article className="adm-kpi inactive">
          <label>Inactive</label>
          <strong>{stats.inactive}</strong>
          <span>No data showing</span>
        </article>
      </div>
      <div className="adm-card">
        <h2>Fleet mix · {stats.total} connectors</h2>
        <p className="adm-lede">
          Cadence {cfg.intervalHours}h · last live sweep {formatAgo(cfg.lastLiveSweep)}
        </p>
        <div className="adm-dist">
          {bars.map(([id, n, color]) => (
            <div key={id} className="adm-dist-row">
              <span>{STATUS[id].label}</span>
              <div className="adm-bar">
                <i style={{ width: `${(100 * n) / total}%`, background: color }} />
              </div>
              <b>{n}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="adm-card">
        <h2>Issued dashboard users · {Math.max(directoryTotal, users.length)}</h2>
        <p className="adm-lede" style={{ margin: 0 }}>
          {users.filter((u) => u.active).length} active · {users.filter((u) => !u.active).length} suspended
          {directoryTotal > users.length ? ` among the ${users.length} listed on the Users tab` : ''}. Create
          accounts on the Users tab.
        </p>
      </div>
    </>
  );
}

export function ApisPage() {
  useRefreshTick();
  const rows = decorateApis(classifyApis());
  const staleMs = intervalMs();
  const [q, setQ] = useState('');
  const [desk, setDesk] = useState('ALL');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState('');

  const qNorm = q.trim().toLowerCase();
  const searched = !qNorm
    ? rows
    : rows.filter((r) =>
        `${r.feature} ${r.desk} ${r.adapter} ${r.url} ${r.note} ${r.lastError || ''}`.toLowerCase().includes(qNorm),
      );

  const statusCounts = { all: 0, live: 0, archive: 0, local: 0, inactive: 0, unchecked: 0 };
  for (const r of searched) {
    if (desk !== 'ALL' && r.desk !== desk) continue;
    statusCounts.all += 1;
    if (statusCounts[r.status] != null) statusCounts[r.status] += 1;
  }

  const deskCounts = { ALL: 0 };
  for (const d of DESKS) deskCounts[d] = 0;
  for (const r of searched) {
    if (status !== 'all' && r.status !== status) continue;
    deskCounts.ALL += 1;
    if (deskCounts[r.desk] != null) deskCounts[r.desk] += 1;
    else deskCounts[r.desk] = 1;
  }

  const shown = searched.filter((r) => {
    if (desk !== 'ALL' && r.desk !== desk) return false;
    if (status !== 'all' && r.status !== status) return false;
    return true;
  });

  async function onOne(row) {
    setBusy(row.key);
    try {
      await refreshOne(row);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <h1 className="adm-h1">API status</h1>
      <p className="adm-lede">
        Last refresh, live/archive/inactive state, and a fleet sweep. Live connectors re-probe on the saved cadence
        (default 6 hours). On the production static host, a shipped pack is last-known-good — it does not move a Live
        connector into Archive or Local pack.
      </p>
      <RefreshBar />
      <div className="adm-filters">
        <input className="adm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search desks, hosts, notes" />
        {['all', 'live', 'archive', 'local', 'inactive', 'unchecked'].map((id) => (
          <button
            key={id}
            type="button"
            className={`adm-chip ${id}${status === id ? ' on' : ''}`}
            onClick={() => setStatus(id)}
          >
            {id === 'all' ? 'All' : STATUS[id].label}
            <span className="adm-chip-count">{statusCounts[id] || 0}</span>
          </button>
        ))}
      </div>
      <div className="adm-filters">
        {DESKS.map((d) => (
          <button key={d} type="button" className={`adm-chip${desk === d ? ' on' : ''}`} onClick={() => setDesk(d)}>
            {d}
            <span className="adm-chip-count">{deskCounts[d] || 0}</span>
          </button>
        ))}
      </div>
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Desk</th>
                <th>Feed</th>
                <th>API URL</th>
                <th>Rows</th>
                <th>Last refreshed</th>
                <th>Adapter</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const stale = !r.lastAt || Date.now() - r.lastAt >= staleMs;
                return (
                  <tr key={r.key} className={r.probing ? 'is-probing' : ''}>
                    <td>
                      <Pill status={r.status} />
                    </td>
                    <td>{r.desk}</td>
                    <td>
                      <div className="feat">{r.feature}</div>
                      <div className="note">{r.lastError || r.note}</div>
                    </td>
                    <td className="api-url-cell">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.url} className="api-url">
                          {(() => { try { return new URL(r.url).hostname; } catch { return r.url.slice(0, 30); } })()}
                        </a>
                      ) : (
                        <span className="note">—</span>
                      )}
                    </td>
                    <td>{r.lastRows != null ? r.lastRows : r.rows || '—'}</td>
                    <td>
                      <div className={`when${stale ? ' stale' : ''}`} title={formatWhen(r.lastAt)}>
                        {formatAgo(r.lastAt)}
                      </div>
                      {stale ? <div className="note">due</div> : null}
                    </td>
                    <td>{r.adapter}</td>
                    <td>
                      <button
                        type="button"
                        className="adm-btn ghost tiny"
                        disabled={busy === r.key || r.probing}
                        onClick={() => onOne(r)}
                      >
                        {busy === r.key || r.probing ? '…' : 'Refresh'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <FeedStoreSection />
    </>
  );
}

const PLAN_NAMES = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max' };

function planDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** The plan as /api/users reports it: effective plan, status and end. */
function planSummary(u) {
  const name = PLAN_NAMES[u.plan] || String(u.plan || 'free');
  if (u.planLapsed && u.planEnd) return `${name} · lapsed ${planDate(u.planEnd)}`;
  if (u.planStatus === 'active') return u.planEnd ? `${name} · to ${planDate(u.planEnd)}` : `${name} · open-ended`;
  return name;
}

const NO_CREDIT_DRAFT = { kind: 'add', amount: '', reason: '', requestId: null };

/** What an applied adjustment says: the user, the amount and the balance now. */
function creditNoteFor(u, request, result) {
  const amount = formatBalance(Math.abs(request.credits));
  const balance = formatBalance(result.balance);
  if (result.repeated) return `That adjustment was already applied to ${u.email}; it was not applied again. Balance ${balance}.`;
  const what = request.kind === 'topup' ? `Granted a top-up of ${amount} credits to ${u.email}`
    : request.credits < 0 ? `Removed ${amount} credits from ${u.email}` : `Added ${amount} credits to ${u.email}`;
  return `${what}. Balance ${balance}.`;
}

// F147: the pause after the last keystroke before the directory is searched.
const SEARCH_PAUSE_MS = 300;
const SEARCH_MAX_LENGTH = 100;
const COUNT = new Intl.NumberFormat('en-IN');

/** "101–200 of 250" for the rows on screen; "0 of 0" when there are none. */
function rangeText(paging, shown) {
  const total = paging.total;
  const first = shown && total ? (paging.page - 1) * paging.pageSize + 1 : 0;
  const last = first ? first + shown - 1 : 0;
  return `${first ? `${COUNT.format(first)}–${COUNT.format(last)}` : '0'} of ${COUNT.format(total)}`;
}

// `paging` is { page, pageSize, total, query } of the page on screen; the store keeps it.
export function UsersPage({ users, onChange, paging = usersPaging() }) {
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  // Per-row plan choice before "Set plan": { [id]: { plan, end } }.
  const [planDrafts, setPlanDrafts] = useState({});
  // Per-row credit form before "Apply": { [id]: { kind, amount, reason, requestId } }.
  // requestId names one adjustment, so a retry after a lost answer applies once.
  const [creditDrafts, setCreditDrafts] = useState({});
  const [creditNote, setCreditNote] = useState('');
  // F147: the text in the search box (it leads the search by a pause), and whether a page is loading.
  const [searchText, setSearchText] = useState(paging.query);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef(null);
  const loads = useRef(0);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // Another page, or another search (from its first page). The store keeps the page it
  // shows, so an edit below refreshes that same page.
  async function showPage(page, q) {
    clearTimeout(searchTimer.current);
    loads.current += 1;
    setLoading(true);
    setErr('');
    const res = await loadUsersPage({ page, q });
    loads.current -= 1;
    setLoading(loads.current > 0);
    if (!res.ok) setErr('The user list could not be loaded. Check the connection and try again.');
    onChange();
  }

  function typeSearch(value) {
    setSearchText(value);
    clearTimeout(searchTimer.current);
    if (value.trim() === paging.query) return;
    searchTimer.current = setTimeout(() => { void showPage(1, value); }, SEARCH_PAUSE_MS);
  }

  function draftFor(u) {
    return planDrafts[u.id] || { plan: PLAN_NAMES[u.plan] ? u.plan : 'free', end: '' };
  }

  function editDraft(u, patch) {
    setPlanDrafts((all) => ({ ...all, [u.id]: { ...draftFor(u), ...patch } }));
  }

  function grantPlan(u) {
    const d = draftFor(u);
    // A chosen day ends at 23:59:59 India time; no day means open-ended.
    const end = d.plan !== 'free' && d.end ? `${d.end}T23:59:59+05:30` : null;
    return change(u.id, () => setUserPlan(u.id, d.plan, end));
  }

  function creditDraftFor(u) {
    return creditDrafts[u.id] || NO_CREDIT_DRAFT;
  }

  // Any edit makes it a different adjustment, so it gets a new request id.
  function editCredit(u, patch) {
    // Keep a draft's denomination even when the directory refreshes beneath it.
    // A stale draft is rejected by the server; an edit never relabels its amount.
    setCreditDrafts((all) => ({ ...all, [u.id]: { ...(all[u.id] || NO_CREDIT_DRAFT), unitVersion: all[u.id] && Object.hasOwn(all[u.id], 'unitVersion') ? all[u.id].unitVersion : (u.creditUnitVersion ?? null), ...patch, requestId: null } }));
  }

  async function applyCredits(u) {
    setCreditNote('');
    const draft = creditDraftFor(u);
    const checked = creditRequest({ ...draft, unitVersion: Object.hasOwn(draft, 'unitVersion') ? draft.unitVersion : u.creditUnitVersion });
    if (!checked.ok) {
      setErr(checked.reason);
      return;
    }
    const { credits, kind, reason, unitVersion } = checked;
    const request = { credits, kind, reason, unitVersion };
    const requestId = draft.requestId || newRequestId();
    // Keep the id with the form until the credits are applied.
    setCreditDrafts((all) => ({ ...all, [u.id]: { ...(all[u.id] || draft), requestId } }));
    setBusyId(u.id);
    setErr('');
    const res = await adjustUserCredits(u.id, request, requestId);
    setBusyId(null);
    if (res.ok) {
      setCreditDrafts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== u.id)));
      setCreditNote(creditNoteFor(u, request, res));
    } else {
      setErr(res.reason || 'The adjustment was not applied.');
    }
    onChange();
  }

  async function change(id, action) {
    setBusyId(id);
    setErr('');
    setCreditNote('');
    const res = await action();
    setBusyId(null);
    if (!res.ok) setErr(res.reason || 'The change was not saved.');
    onChange();
  }

  return (
    <>
      <h1 className="adm-h1">Dashboard users</h1>
      <p className="adm-lede">
        Every account that has signed up, 100 to a page; search by name or email. Assign a user type so each seat opens the matching desks. Set a plan to grant
        Plus, Pro or Max until a date (or open-ended), or Free to revoke; verified payments set plans on their
        own. Credits shows each balance (and any debt) as of their last activity: it updates when they next
        use AI. Add or remove credits, or grant a top-up, with a reason that is kept with the adjustment. Suspend to lock an account without deleting it, and restore to reopen it.
      </p>
      <div className="adm-card">
        <h2>Adding people</h2>
        <p className="adm-hint" style={{ marginTop: 0 }}>
          Accounts are created only through sign-up on the website. Admins cannot create accounts or set passwords here;
          people reset their own password from the sign-in page. Owner accounts cannot be changed from this screen.
        </p>
        {err ? (
          <p className="adm-msg err" role="alert">
            {err}
          </p>
        ) : null}
        {creditNote ? (
          <p className="adm-msg" role="status">
            {creditNote}
          </p>
        ) : null}
      </div>
      <div className="adm-card adm-users-bar">
        <input
          type="search"
          className="adm-users-search"
          aria-label="Search users by name or email"
          placeholder="Search by name or email"
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          value={searchText}
          onChange={(e) => typeSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void showPage(1, searchText);
          }}
        />
        <div className="adm-pager" role="group" aria-label="Pages of users">
          <span className="adm-pager-range" aria-live="polite">
            {rangeText(paging, users.length)}
          </span>
          <button
            type="button"
            className="adm-btn ghost adm-pager-prev"
            disabled={loading || busyId !== null || paging.page <= 1}
            onClick={() => { void showPage(paging.page - 1, paging.query); }}
          >
            Previous
          </button>
          <button
            type="button"
            className="adm-btn ghost adm-pager-next"
            disabled={loading || busyId !== null || paging.page * paging.pageSize >= paging.total}
            onClick={() => { void showPage(paging.page + 1, paging.query); }}
          >
            Next
          </button>
        </div>
      </div>
      <div className={`adm-card${loading ? ' adm-loading' : ''}`} style={{ padding: 0 }} aria-busy={loading || undefined}>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th>Plan</th>
                <th>Credits</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="adm-empty">
                    {paging.query ? 'No users match this search.' : 'No users yet.'}
                  </td>
                </tr>
              ) : null}
              {users.map((u) => {
                const locked = u.role === 'owner';
                const busy = busyId !== null;
                return (
                  <tr key={u.id}>
                    <td className="feat">{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="adm-inline-select"
                        aria-label={`User type for ${u.email}`}
                        value={userTypeOf(u.type).id}
                        disabled={locked || busy}
                        onChange={(e) => {
                          const type = e.target.value;
                          void change(u.id, () => setUserType(u.id, type));
                        }}
                      >
                        {USER_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.short}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="adm-plan-cell">
                        <span className="adm-plan-now">{planSummary(u)}</span>
                        <select
                          className="adm-inline-select"
                          aria-label={`Plan for ${u.email}`}
                          value={draftFor(u).plan}
                          disabled={locked || busy}
                          onChange={(e) => editDraft(u, { plan: e.target.value })}
                        >
                          {Object.entries(PLAN_NAMES).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          className="adm-inline-select"
                          aria-label={`Plan end date for ${u.email} (empty for open-ended)`}
                          value={draftFor(u).end}
                          disabled={locked || busy || draftFor(u).plan === 'free'}
                          onChange={(e) => editDraft(u, { end: e.target.value })}
                        />
                        <button
                          type="button"
                          className="adm-btn ghost adm-plan-set"
                          disabled={locked || busy}
                          onClick={() => { void grantPlan(u); }}
                        >
                          Set plan
                        </button>
                      </div>
                    </td>
                    <td className="admin-credits">
                      <div className="admin-credits-cell" role="group" aria-label={`Credits for ${u.email}`}>
                        <span className="admin-credits-balance" title="As of the last activity of this user, until they next use AI">{formatBalance(u.creditBalance)}</span>
                        {u.creditDebt > 0 ? (
                          <span className="admin-credits-debt">{`Owes ${formatBalance(u.creditDebt)}`}</span>
                        ) : null}
                        <select
                          className="adm-inline-select admin-credits-field"
                          aria-label={`Credit action for ${u.email}`}
                          value={creditDraftFor(u).kind}
                          disabled={locked || busy || !u.creditUnitVersion}
                          onChange={(e) => editCredit(u, { kind: e.target.value })}
                        >
                          {CREDIT_ACTIONS.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          className="adm-inline-select admin-credits-field"
                          aria-label={`Credit amount for ${u.email}`}
                          placeholder="Credits"
                          value={creditDraftFor(u).amount}
                          disabled={locked || busy || !u.creditUnitVersion}
                          onChange={(e) => editCredit(u, { amount: e.target.value })}
                        />
                        <input
                          type="text"
                          maxLength={500}
                          className="adm-inline-select admin-credits-field admin-credits-reason"
                          aria-label={`Credit reason for ${u.email}`}
                          aria-required="true"
                          placeholder="Reason (required)"
                          value={creditDraftFor(u).reason}
                          disabled={locked || busy || !u.creditUnitVersion}
                          onChange={(e) => editCredit(u, { reason: e.target.value })}
                        />
                        <button
                          type="button"
                          className="adm-btn ghost admin-credits-apply"
                          disabled={locked || busy || !u.creditUnitVersion}
                          onClick={() => { void applyCredits(u); }}
                        >
                          {busyId === u.id ? 'Saving…' : 'Apply'}
                        </button>
                      </div>
                    </td>
                    <td>{locked ? 'Owner' : u.active ? 'Active' : 'Suspended'}</td>
                    <td>
                      <div className="adm-actions" style={{ margin: 0 }}>
                        <button
                          type="button"
                          className={u.active ? 'adm-btn danger adm-state' : 'adm-btn ghost adm-state'}
                          disabled={locked || busy}
                          onClick={() => { void change(u.id, () => setUserActive(u.id, !u.active)); }}
                        >
                          {busyId === u.id ? 'Saving…' : u.active ? 'Suspend' : 'Restore'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

