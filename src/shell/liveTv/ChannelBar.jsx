// B6: the channel bar. Row one: "My list", Hindi and English tabs over a strip of tiles. Row two: All and the eight
// segments with counts, and a search box. A segment, All, or a search opens a panel that overlays the page under
// the bar (it never pushes the video down). On phones a "Channels" button opens the same choices as a full sheet.
// Presentational: the page owns the playing channel and the followed list; this owns only what is open.
import { useEffect, useRef, useState } from 'react';
import { channelSubline } from './channelView.js';
import { matchChannels, regionChips, primaryLanguage } from './channelSearch.js';

export const EMPTY_SEARCH = 'No channel matches that. Paste its YouTube link at the top to watch and fact-check it anyway.';
export const EMPTY_MY_LIST = 'Follow a channel and it shows up here for one-tap access.';

function scrollStrip(el, direction) {
  if (!el || typeof el.scrollBy !== 'function') return;
  let calm = false;
  try { calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  el.scrollBy({ left: direction * Math.max(160, Math.round(el.clientWidth * 0.8)), behavior: calm ? 'auto' : 'smooth' });
}

function Tile({ ch, active, onPick, className = '' }) {
  const sub = channelSubline(ch);
  return (
    <button
      type="button"
      className={`ltv-channel-chip${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => onPick(ch)}
      title={`${ch.name}${ch.lang ? ` (${ch.lang})` : ''}`}
    >
      <span className="ltv-chip-tag" style={{ background: ch.color || '#3b82f6' }}>{ch.short || ch.name.slice(0, 3)}</span>
      <span className="ltv-chip-text">
        <span className="ltv-chip-name">{ch.name}</span>
        {sub ? <span className={`ltv-chip-status ltv-chip-status-${ch.status || 'recent'}`}>{sub}</span> : null}
      </span>
    </button>
  );
}

function Grid({ groups, activeId, onPick, empty }) {
  const total = groups.reduce((n, g) => n + g.tiles.length, 0);
  if (!total) return <p className="ltv-pop-empty" role="status">{empty}</p>;
  return (
    <div className="ltv-pop-groups">
      {groups.map((g) => (g.tiles.length ? (
        <div key={g.id}>
          {g.title ? <div className="ltv-pop-group-title">{g.title}</div> : null}
          <div className="ltv-pop-grid">
            {g.tiles.map((ch) => <Tile key={ch.id} ch={ch} active={ch.id === activeId} onPick={onPick} />)}
          </div>
        </div>
      ) : null))}
    </div>
  );
}

/**
 * channels   every channel, with the status to show; lists   the ten lists ({ id, name, short, kind });
 * following  followed channel ids, in the order followed;   activeChannelId, playbackMode   what is playing
 * initial    { top, pop, query, region, sheet } opens the bar in a given state (previews and tests)
 */
export function ChannelBar({ channels, lists, activeChannelId, playbackMode, loading, following = [], onSelectChannel, initial = {} }) {
  const tops = lists.filter((l) => l.kind === 'top');
  const segs = lists.filter((l) => l.kind !== 'top');
  const [top, setTop] = useState(initial.top || tops[0]?.id || 'my');
  const [pop, setPop] = useState(initial.pop || null); // null | { kind: 'all' | 'seg' | 'search', id? }
  const [query, setQuery] = useState(initial.query || '');
  const [region, setRegion] = useState(initial.region || 'All');
  const [sheet, setSheet] = useState(initial.sheet || null); // null | { view: 'home' | 'all' | <segment id> }
  const strip = useRef(null);
  const heading = useRef(null);
  const searchInput = useRef(null);
  const sheetHeading = useRef(null);
  const back = useRef(null); // the control to give focus back to when a panel closes

  const byId = new Map(channels.map((c) => [c.id, c]));
  const inList = (id) => channels.filter((c) => c.lists?.includes(id));
  const mine = following.map((id) => byId.get(id)).filter(Boolean);
  const topChannels = top === 'my' ? mine : inList(top);
  const active = (ch) => ch.id === activeChannelId && playbackMode === 'live';

  const listName = (id) => lists.find((l) => l.id === id)?.name || '';
  const openPop = (next, e) => { back.current = e?.currentTarget || null; setPop(next); setRegion('All'); };
  const closePop = () => {
    setPop(null);
    if (query) setQuery('');
    const target = pop?.kind === 'search' ? searchInput.current : back.current;
    back.current = null;
    target?.focus?.();
  };
  const pick = (ch) => {
    onSelectChannel(ch);
    setPop(null);
    setSheet(null);
    setQuery('');
    back.current = null;
  };
  const closeSheet = () => {
    setSheet(null);
    setQuery('');
    const target = back.current;
    back.current = null;
    target?.focus?.();
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || (!pop && !sheet)) return;
    e.preventDefault?.();
    if (sheet) closeSheet(); else closePop();
  };
  const onQuery = (value, fromSheet) => {
    setQuery(value);
    if (fromSheet) return;
    if (value.trim()) { if (!pop || pop.kind !== 'search') setPop({ kind: 'search' }); }
    else if (pop?.kind === 'search') { setPop(null); }
  };

  // Focus moves into a panel opened from a button; a search panel leaves it in the box the user is typing in.
  const popKey = pop ? `${pop.kind}:${pop.id || ''}` : '';
  useEffect(() => { if (pop && pop.kind !== 'search') heading.current?.focus(); }, [popKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetKey = sheet ? sheet.view : '';
  useEffect(() => { if (sheet) sheetHeading.current?.focus(); }, [sheetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const regionalChips = pop?.kind === 'seg' && pop.id === 'regional' ? regionChips(inList('regional')) : [];
  function panel() {
    if (!pop) return null;
    let title; let groups;
    if (pop.kind === 'search') {
      title = 'Search results';
      groups = [{ id: 'q', title: '', tiles: matchChannels(channels, query) }];
    } else if (pop.kind === 'all') {
      title = 'All channels';
      groups = lists.map((l) => ({ id: l.id, title: l.name, tiles: channels.filter((c) => (c.lists?.[0] || '') === l.id) }));
      const rest = channels.filter((c) => !c.lists?.length || !lists.some((l) => l.id === c.lists[0]));
      groups.push({ id: 'rest', title: 'Other', tiles: rest });
    } else {
      title = listName(pop.id);
      const tiles = inList(pop.id).filter((c) => pop.id !== 'regional' || region === 'All' || primaryLanguage(c.lang) === region);
      groups = [{ id: pop.id, title: '', tiles }];
    }
    const count = groups.reduce((n, g) => n + g.tiles.length, 0);
    return (
      <div className="ltv-pop" role="dialog" aria-label={title}>
        <div className="ltv-pop-head">
          <h3 className="ltv-pop-title" tabIndex={-1} ref={heading}>{title} <span className="ltv-pop-count">{count}</span></h3>
          <button type="button" className="ltv-arrow ltv-pop-close" aria-label="Close channel menu" onClick={closePop}><span aria-hidden="true">×</span></button>
        </div>
        {regionalChips.length ? (
          <div className="ltv-region-chips" role="group" aria-label="Language">
            {[{ label: 'All', count: inList('regional').length }, ...regionalChips].map((r) => (
              <button type="button" key={r.label} className={`ltv-category-pill${region === r.label ? ' active' : ''}`} aria-pressed={region === r.label} onClick={() => setRegion(r.label)}>
                {r.label} <span className="ltv-category-count">{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="ltv-pop-body"><Grid groups={groups} activeId={activeChannelId && playbackMode === 'live' ? activeChannelId : ''} onPick={pick} empty={pop.kind === 'search' ? EMPTY_SEARCH : 'No channels in this list yet.'} /></div>
      </div>
    );
  }

  function sheetBody() {
    const view = sheet.view;
    if (query.trim()) {
      return <Grid groups={[{ id: 'q', title: '', tiles: matchChannels(channels, query) }]} activeId={activeChannelId} onPick={pick} empty={EMPTY_SEARCH} />;
    }
    if (view === 'all') {
      return <Grid groups={lists.map((l) => ({ id: l.id, title: l.name, tiles: channels.filter((c) => (c.lists?.[0] || '') === l.id) }))} activeId={activeChannelId} onPick={pick} empty="No channels." />;
    }
    if (view !== 'home') {
      return <Grid groups={[{ id: view, title: listName(view), tiles: inList(view) }]} activeId={activeChannelId} onPick={pick} empty="No channels in this list yet." />;
    }
    return (
      <>
        <div className="ltv-sheet-label">TOP CHANNELS</div>
        <div className="ltv-toptabs" role="group" aria-label="Top channel list">
          {topTabs.map((t) => (
            <button type="button" key={t.id} className="ltv-toptab" aria-pressed={top === t.id} onClick={() => setTop(t.id)}>{t.label} <span className="ltv-category-count">{t.n}</span></button>
          ))}
        </div>
        {topChannels.length
          ? <div className="ltv-pop-grid">{topChannels.map((ch) => <Tile key={ch.id} ch={ch} active={ch.id === activeChannelId} onPick={pick} />)}</div>
          : <p className="ltv-pop-empty">{top === 'my' ? EMPTY_MY_LIST : 'No channels in this list yet.'}</p>}
        <div className="ltv-sheet-label">SEGMENTS</div>
        <div className="ltv-sheet-segs">
          <button type="button" className="ltv-category-pill" onClick={() => setSheet({ view: 'all' })}>All <span className="ltv-category-count">{channels.length}</span></button>
          {segs.map((s) => (
            <button type="button" key={s.id} className="ltv-category-pill" onClick={() => setSheet({ view: s.id })}>{s.short || s.name} <span className="ltv-category-count">{inList(s.id).length}</span></button>
          ))}
        </div>
      </>
    );
  }

  const topTabs = [{ id: 'my', label: 'My list', n: mine.length }, ...tops.map((l) => ({ id: l.id, label: l.short || l.name, n: inList(l.id).length }))];

  return (
    <section className="ltv-channelcard ltv-channelbar" aria-label="Channels" onKeyDown={onKeyDown}>
      <div className="ltv-row">
        <div className="ltv-row-head">
          <span className="ltv-row-label">TOP CHANNELS</span>
          <div className="ltv-toptabs" role="group" aria-label="Top channel list">
            {topTabs.map((t) => (
              <button type="button" key={t.id} className="ltv-toptab" aria-pressed={top === t.id} onClick={() => setTop(t.id)}>
                {t.label} <span className="ltv-category-count">{t.n}</span>
              </button>
            ))}
          </div>
        </div>
        <nav className="ltv-strip-wrap" aria-label="Available Channels">
          {loading ? (
            <div className="ltv-strip-loading">Loading curated sources...</div>
          ) : topChannels.length === 0 ? (
            <div className="ltv-strip-loading">{top === 'my' ? EMPTY_MY_LIST : 'No channels in this list yet.'}</div>
          ) : (
            <div className="ltv-strip" ref={strip}>
              {topChannels.map((ch) => <Tile key={ch.id} ch={ch} active={active(ch)} onPick={pick} />)}
            </div>
          )}
          <div className="ltv-strip-arrows">
            <button type="button" className="ltv-arrow" aria-label="Scroll channels left" onClick={() => scrollStrip(strip.current, -1)}><span aria-hidden="true">‹</span></button>
            <button type="button" className="ltv-arrow" aria-label="Scroll channels right" onClick={() => scrollStrip(strip.current, 1)}><span aria-hidden="true">›</span></button>
          </div>
        </nav>
        <button type="button" className="ltv-action-btn ltv-sheet-open" aria-haspopup="dialog" aria-expanded={Boolean(sheet)} onClick={(e) => { back.current = e.currentTarget; setSheet({ view: 'home' }); }}>
          Channels
        </button>
      </div>

      <div className="ltv-row ltv-seg-row">
        <span className="ltv-row-label">SEGMENTS</span>
        <div className="ltv-category-bar" role="group" aria-label="Segments">
          <button type="button" className={`ltv-category-pill${pop?.kind === 'all' ? ' active' : ''}`} aria-expanded={pop?.kind === 'all'} aria-haspopup="dialog" onClick={(e) => (pop?.kind === 'all' ? closePop() : openPop({ kind: 'all' }, e))}>
            All <span className="ltv-category-count">{channels.length}</span>
          </button>
          {segs.map((s) => {
            const on = pop?.kind === 'seg' && pop.id === s.id;
            return (
              <button type="button" key={s.id} className={`ltv-category-pill${on ? ' active' : ''}`} aria-expanded={on} aria-haspopup="dialog" onClick={(e) => (on ? closePop() : openPop({ kind: 'seg', id: s.id }, e))}>
                {s.short || s.name} <span className="ltv-category-count">{inList(s.id).length}</span>
              </button>
            );
          })}
        </div>
        <label className="ltv-find">
          <span className="ltv-sr-only">Find a channel</span>
          <input type="search" ref={searchInput} className="ltv-find-input" placeholder="Find a channel" value={query} autoComplete="off" onChange={(e) => onQuery(e.target.value, false)} />
        </label>
      </div>

      {panel()}

      {sheet ? (
        <div className="ltv-sheet" role="dialog" aria-label="Channels">
          <div className="ltv-sheet-head">
            {sheet.view !== 'home' && !query.trim() ? (
              <button type="button" className="ltv-action-btn" onClick={() => setSheet({ view: 'home' })}>Back</button>
            ) : null}
            <h2 className="ltv-sheet-title" tabIndex={-1} ref={sheetHeading}>Channels</h2>
            <button type="button" className="ltv-arrow" aria-label="Close channels" onClick={closeSheet}><span aria-hidden="true">×</span></button>
          </div>
          <label className="ltv-find ltv-sheet-find">
            <span className="ltv-sr-only">Find a channel</span>
            <input type="search" className="ltv-find-input" placeholder="Find a channel" value={query} autoComplete="off" onChange={(e) => onQuery(e.target.value, true)} />
          </label>
          <div className="ltv-sheet-body">{sheetBody()}</div>
        </div>
      ) : null}
    </section>
  );
}
