import { useEffect, useState } from 'react';
import { apiStats, classifyApis, STATUS } from '../lib/apiStatus.js';
import { setUserActive, setUserType, USER_TYPES, userTypeOf } from '../lib/userStore.js';
import { loadPricing, savePricing } from '../lib/pricingStore.js';
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
import { liveApiEnabled } from '../lib/apiMode.js';
import { cancelSweep, decorateApis, healStaleInactiveProbes, healStaticHostProbes, refreshOne, sweepApis } from '../lib/refreshFeeds.js';

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

  useEffect(() => {
    healStaticHostProbes();
    if (liveApiEnabled()) healStaleInactiveProbes().catch(() => {});
  }, []);

  const rows = decorateApis(classifyApis());
  const stats = apiStats(rows);
  const total = stats.total || 1;
  const cfg = loadRefreshCfg();
  const bars = [
    ['live', stats.live, '#176b55'],
    ['archive', stats.archive, '#c4a35a'],
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
          <label>Archive</label>
          <strong>{stats.archive}</strong>
          <span>Live failed · archive showing</span>
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
        <h2>Issued dashboard users · {users.length}</h2>
        <p className="adm-lede" style={{ margin: 0 }}>
          {users.filter((u) => u.active).length} active · {users.filter((u) => !u.active).length} suspended. Create
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

  useEffect(() => {
    healStaticHostProbes();
    if (liveApiEnabled()) healStaleInactiveProbes().catch(() => {});
  }, []);

  const qNorm = q.trim().toLowerCase();
  const searched = !qNorm
    ? rows
    : rows.filter((r) =>
        `${r.feature} ${r.desk} ${r.adapter} ${r.url} ${r.note} ${r.lastError || ''}`.toLowerCase().includes(qNorm),
      );

  const statusCounts = { all: 0, live: 0, archive: 0, local: 0, inactive: 0 };
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
        {['all', 'live', 'archive', 'local', 'inactive'].map((id) => (
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
    </>
  );
}

export function UsersPage({ users, onChange }) {
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function change(id, action) {
    setBusyId(id);
    setErr('');
    const res = await action();
    setBusyId(null);
    if (!res.ok) setErr(res.reason || 'The change was not saved.');
    onChange();
  }

  return (
    <>
      <h1 className="adm-h1">Dashboard users</h1>
      <p className="adm-lede">
        Every account that has signed up. Assign a user type so each seat opens the matching desks. Suspend to lock an
        account without deleting it, and restore to reopen it.
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
      </div>
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th>Plan</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
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
                    <td>{u.plan}</td>
                    <td>{locked ? 'Owner' : u.active ? 'Active' : 'Suspended'}</td>
                    <td>
                      <div className="adm-actions" style={{ margin: 0 }}>
                        <button
                          type="button"
                          className={u.active ? 'adm-btn danger' : 'adm-btn ghost'}
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

export function PricingAdminPage() {
  const [plans, setPlans] = useState(() => loadPricing());
  const [msg, setMsg] = useState('');

  function patch(id, field, value) {
    setPlans((list) => list.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    setMsg('');
  }

  function onSave(e) {
    e.preventDefault();
    savePricing(plans);
    setMsg('Pricing published to the public page.');
  }

  return (
    <>
      <h1 className="adm-h1">Pricing</h1>
      <p className="adm-lede">
        These figures and blurbs are what the marketing pricing page renders. Save to publish immediately in this
        browser.
      </p>
      <form onSubmit={onSave}>
        <div className="adm-plans">
          {plans.map((p) => (
            <article key={p.id} className="adm-plan">
              <h3 style={{ color: p.color }}>{p.name}</h3>
              <div className="adm-form">
                <label className="adm-field">
                  <span>Display name</span>
                  <input value={p.name} onChange={(e) => patch(p.id, 'name', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Audience</span>
                  <input value={p.who} onChange={(e) => patch(p.id, 'who', e.target.value)} />
                </label>
                <label className="adm-field">
                  <span>Monthly $</span>
                  <input
                    type="number"
                    min="0"
                    value={p.monthly ?? 0}
                    onChange={(e) => patch(p.id, 'monthly', Number(e.target.value))}
                    disabled={p.custom}
                  />
                </label>
                <label className="adm-field">
                  <span>Yearly $ / mo</span>
                  <input
                    type="number"
                    min="0"
                    value={p.yearly ?? 0}
                    onChange={(e) => patch(p.id, 'yearly', Number(e.target.value))}
                    disabled={p.custom}
                  />
                </label>
                <label className="adm-field span2">
                  <span>Custom quote</span>
                  <select
                    value={p.custom ? 'yes' : 'no'}
                    onChange={(e) => patch(p.id, 'custom', e.target.value === 'yes')}
                  >
                    <option value="no">Priced</option>
                    <option value="yes">Custom / contact sales</option>
                  </select>
                </label>
                <label className="adm-field span2">
                  <span>Tagline</span>
                  <input value={p.tag} onChange={(e) => patch(p.id, 'tag', e.target.value)} />
                </label>
                <label className="adm-field span2">
                  <span>Features (one per line)</span>
                  <textarea
                    value={(p.items || []).join('\n')}
                    onChange={(e) =>
                      patch(
                        p.id,
                        'items',
                        e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
        <div className="adm-actions">
          <button className="adm-btn" type="submit">
            Publish pricing
          </button>
          {msg ? <span className="adm-msg">{msg}</span> : null}
        </div>
      </form>
    </>
  );
}
