import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import {
  DB_WARN_BYTES,
  FEED_FILTERS,
  filterCounts,
  filterFeedRows,
  formatBytes,
  formatFeedAge,
  isFailing,
  loadFeedStore,
  sizeWarning,
  sortFeedRows,
} from './feedAdmin.js';

function Marker({ kind }) {
  // Always a word; the colour only repeats it.
  return kind === 'failing'
    ? <span className="adm-pill inactive"><i />Failing</span>
    : <span className="adm-pill archive"><i />Stale</span>;
}

export function DatabaseSize({ sizes, note }) {
  if (!sizes) return note ? <p className="adm-hint">{note}</p> : null;
  const warn = sizeWarning(sizes.database);
  return (
    <div className="adm-card" style={{ padding: 16 }}>
      <h3 className="adm-feed-sub">Database size</h3>
      <p style={{ margin: '0 0 8px' }}>
        <b>{formatBytes(sizes.database)}</b> in total. The warning level is {formatBytes(DB_WARN_BYTES)}.
      </p>
      {warn ? (
        <p className="adm-msg err" role="alert">
          Warning: the database is {formatBytes(sizes.database)}, at or over the {formatBytes(DB_WARN_BYTES)} warning level.
        </p>
      ) : null}
      <table className="adm-table">
        <caption className="adm-hint" style={{ textAlign: 'left' }}>Feed tables, with their indexes</caption>
        <thead>
          <tr><th scope="col">Table</th><th scope="col">Size</th></tr>
        </thead>
        <tbody>
          {sizes.tables.map((t) => (
            <tr key={t.name}><th scope="row">{t.name}</th><td>{formatBytes(t.bytes)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeedRow({ row, now }) {
  const runs = row.okRuns24h + row.failedRuns24h
    ? `${row.okRuns24h} ok, ${row.failedRuns24h} failed in 24 h`
    : 'no runs in 24 h';
  return (
    <tr>
      <th scope="row">
        <div className="feat">{row.feature}{row.variant ? ` (${row.variant})` : ''}</div>
        <div className="note">{row.tier} · every {row.intervalMinutes} min{row.leased ? ' · running now' : ''}</div>
        {isFailing(row) && row.lastError ? <div className="note">{row.lastError}</div> : null}
      </th>
      <td>{row.cls || '—'}</td>
      <td>{row.serve ? 'On' : 'Off'}</td>
      <td>
        <span title={row.fetchedAt ? new Date(row.fetchedAt).toISOString() : ''}>{formatFeedAge(row.fetchedAt, now)}</span>
        {row.stale ? <div className="note">limit {row.staleAfterMinutes} min</div> : null}
      </td>
      <td>
        {row.failures ? `${row.failures} in a row` : '0'}
        <div className="note">{runs}</div>
      </td>
      <td>{row.items}</td>
      <td>
        {isFailing(row) ? <Marker kind="failing" /> : null}
        {row.stale ? <Marker kind="stale" /> : null}
        {!isFailing(row) && !row.stale ? 'OK' : null}
      </td>
    </tr>
  );
}

/** The section for a loaded state. No hooks: the container below owns loading and the filter. */
export function FeedStoreView({ state, filter = 'all', onFilter = () => {}, onRetry = () => {}, now = Date.now() }) {
  let body;
  if (!state || state.status === 'loading') {
    body = <p className="adm-hint" role="status">Loading the scheduled feeds…</p>;
  } else if (state.status === 'notSetUp') {
    body = (
      <p className="adm-hint" role="status">
        Not set up yet. The scheduled feed store&apos;s health view is not installed on this database; it appears once the
        feed migrations are applied.
      </p>
    );
  } else if (state.status === 'error') {
    body = (
      <>
        <p className="adm-msg err" role="alert">Could not load the scheduled feeds: {state.message}</p>
        <button className="adm-btn ghost" type="button" onClick={onRetry}>Try again</button>
      </>
    );
  } else {
    const counts = filterCounts(state.rows);
    const shown = sortFeedRows(filterFeedRows(state.rows, filter));
    body = (
      <>
        <DatabaseSize sizes={state.sizes} note={state.sizesNote} />
        <div className="adm-filters" role="group" aria-label="Filter scheduled feeds">
          {FEED_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`adm-chip${filter === f.id ? ' on' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
              <span className="adm-chip-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="adm-card" style={{ padding: 0 }}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="adm-hint" style={{ textAlign: 'left', padding: '8px 12px' }}>
                Scheduled modules, failing and stale first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  <th scope="col">Class</th>
                  <th scope="col">Serve</th>
                  <th scope="col">Last success</th>
                  <th scope="col">Failures</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.length
                  ? shown.map((r) => <FeedRow key={r.key} row={r} now={now} />)
                  : (
                    <tr>
                      <td className="adm-empty" colSpan={7}>
                        {state.rows.length ? 'No module matches this filter.' : 'No scheduled modules recorded yet. The first refresh run adds them.'}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }
  return (
    <section aria-labelledby="adm-feed-store-title" className="adm-feed-store">
      <h2 id="adm-feed-store-title" className="adm-feed-title">Scheduled feeds</h2>
      {body}
    </section>
  );
}

/** Reads the feed store's health with the admin's session and shows it. Re-read every minute and on demand. */
export default function FeedStoreSection({ client = supabase }) {
  const [state, setState] = useState({ status: 'loading' });
  const [filter, setFilter] = useState('all');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadFeedStore(client).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => { cancelled = true; };
  }, [client, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <FeedStoreView
      state={state}
      filter={filter}
      onFilter={setFilter}
      onRetry={() => { setState({ status: 'loading' }); setTick((n) => n + 1); }}
      now={Date.now()}
    />
  );
}
