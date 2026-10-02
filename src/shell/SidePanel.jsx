import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import AiPanel from '../ai/AiPanel.jsx';
import RailContent, { railClasses } from './RailContent.jsx';
import { COLLAPSED_STORAGE_KEY, availableTabs, initialPanel, panelReducer, readStoredCollapsed } from './sidePanelModel.js';
import { writeStored } from './resizeModel.js';

/**
 * The side panel (docs/specs/2026-10-03-side-panel.md): one component for the right of the
 * workspace, with Desk, Record and AI research as tabs of one tablist. It replaces the rail and the
 * AI dock, which took turns in the same grid column.
 *
 * Its state lives in the shell (useSidePanel), so the workspace's layout classes come from the same
 * state in the same render and the desk lays out once per change (panel-loading spec D). A tab once
 * shown stays mounted, hidden when another is active, so AI keeps its thread, draft and a streaming
 * answer, and Desk and Record keep their scroll.
 */

const LABELS = {
  desk: ['Desk', 'डेस्क'],
  record: ['Record', 'रिकॉर्ड'],
  ai: ['AI research', 'एआई अनुसंधान'],
};
const label = (tab, hi) => LABELS[tab][hi ? 1 : 0];
const tabId = (tab) => `side-panel-tab-${tab}`;
const panelId = (tab) => `side-panel-${tab}`;

const storage = () => (typeof window !== 'undefined' ? window.localStorage : null);

/**
 * The panel's state, with the desk as context: `hasRail` (the desk shows Desk and Record), the
 * selected row and the module. Row and desk changes are applied during render, so the tab and the
 * layout change in the same render as the selection.
 */
export function useSidePanel({ hasRail, selected, featureName }) {
  const ctx = { hasRail, selected };
  const [state, dispatch] = useReducer(
    (s, a) => panelReducer(s, a, a.ctx),
    null,
    () => initialPanel({ ...ctx, collapsed: hasRail && readStoredCollapsed(storage()) }),
  );
  const [seen, setSeen] = useState({ selected, hasRail, featureName });
  if (seen.selected !== selected || seen.hasRail !== hasRail || seen.featureName !== featureName) {
    setSeen({ selected, hasRail, featureName });
    if (seen.hasRail !== hasRail || seen.featureName !== featureName) dispatch({ type: 'context', ctx });
    else if (selected) dispatch({ type: 'select', ctx });
    else dispatch({ type: 'clear', ctx });
  }

  // The reader's collapse is remembered per browser; it applies to desks with a rail.
  const collapsedRef = useRef(state.collapsed);
  useEffect(() => {
    if (collapsedRef.current === state.collapsed) return;
    collapsedRef.current = state.collapsed;
    writeStored(storage(), COLLAPSED_STORAGE_KEY, state.collapsed ? '1' : null);
  }, [state.collapsed]);

  // Every "Ask AI" entry point fires niy-ai-open (lib/aiDrop.js). It selects the AI tab and hands
  // the chat its seed: the row, attachments, a prompt or dropped files.
  const [seed, setSeed] = useState(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => {
    function onOpen(e) {
      const detail = e.detail && typeof e.detail === 'object' ? e.detail : {};
      const row = ctxRef.current.selected;
      const intentional = detail.row || detail.drop || detail.prompt || detail.attachFeed || detail.droppedFiles?.length;
      dispatch({ type: 'ai-open', ctx: ctxRef.current });
      if (Object.keys(detail).length) {
        setSeed({ ...detail, row: detail.row || row || undefined, attachFeed: detail.attachFeed || Boolean(detail.row || row) });
      } else if (intentional && row) {
        setSeed({ row, attachFeed: true });
      }
    }
    window.addEventListener('niy-ai-open', onOpen);
    return () => window.removeEventListener('niy-ai-open', onOpen);
  }, []);

  const aiActive = state.open && state.active === 'ai';
  useEffect(() => {
    if (!aiActive) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') dispatch({ type: 'close-ai', ctx: ctxRef.current });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [aiActive]);

  const act = useCallback((action) => dispatch({ ...action, ctx: ctxRef.current }), []);
  const consumeSeed = useCallback(() => setSeed(null), []);
  return { state, act, seed, consumeSeed, aiOpen: aiActive, collapsed: hasRail && state.collapsed };
}

export default function SidePanel({ panel, hasRail, feed, selected, onSelect, lang, loading, vizFilter, tab, featureName }) {
  const { state, act, seed, consumeSeed } = panel;
  const hi = lang === 'hi';
  const tabs = availableTabs({ hasRail, selected });
  const tabRefs = useRef({});
  const closeAi = useCallback(() => act({ type: 'close-ai' }), [act]);

  function onTabKey(e) {
    const i = tabs.indexOf(state.active);
    const next =
      e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home' ? tabs[0]
            : e.key === 'End' ? tabs[tabs.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    act({ type: 'tab', tab: next });
    tabRefs.current[next]?.focus();
  }

  const shown = (t) => state.open && state.active === t;
  const collapsed = hasRail && state.collapsed;

  return (
    <aside
      className={`side-panel${state.active === 'ai' ? ' is-ai' : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={hi ? 'साइड पैनल' : 'Side panel'}
      hidden={!state.open && !collapsed}
    >
      {collapsed ? (
        <div className="side-panel-handle" role="toolbar" aria-orientation="vertical" aria-label={hi ? 'पैनल खोलें' : 'Open the panel'}>
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => act({ type: 'reopen', tab: t })} title={label(t, hi)}>
              {label(t, hi)}
            </button>
          ))}
        </div>
      ) : (
        <div className="side-panel-bar">
          <div className="side-panel-tabs" role="tablist" aria-label={hi ? 'पैनल' : 'Panel'} onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button
                key={t}
                ref={(el) => { tabRefs.current[t] = el; }}
                type="button"
                role="tab"
                id={tabId(t)}
                aria-selected={state.active === t}
                aria-controls={panelId(t)}
                tabIndex={state.active === t ? 0 : -1}
                className={state.active === t ? 'on' : ''}
                onClick={() => act({ type: 'tab', tab: t })}
              >
                {label(t, hi)}
              </button>
            ))}
          </div>
          <div className="side-panel-actions">
            {hasRail ? (
              <button type="button" className="side-panel-collapse" onClick={() => act({ type: 'collapse' })} aria-label={hi ? 'पैनल छोटा करें' : 'Collapse the panel'} title={hi ? 'छोटा करें' : 'Collapse'}>
                <span aria-hidden="true">⇥</span>
              </button>
            ) : (
              <button type="button" className="side-panel-collapse" onClick={closeAi} aria-label={hi ? 'बंद करें' : 'Close'} title={hi ? 'बंद करें' : 'Close'}>
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="side-panel-body" hidden={collapsed}>
        {['desk', 'record'].filter((t) => state.mounted.includes(t)).map((t) => (
          <div
            key={`${t}:${feed?.feature || 'empty'}`}
            role="tabpanel"
            id={panelId(t)}
            aria-labelledby={tabId(t)}
            className={railClasses(feed)}
            hidden={!shown(t) || !tabs.includes(t)}
          >
            <RailContent view={t} feed={feed} selected={selected} onSelect={onSelect} loading={loading} vizFilter={vizFilter} />
          </div>
        ))}
        {state.mounted.includes('ai') ? (
          <div role="tabpanel" id={panelId('ai')} aria-labelledby={tabId('ai')} className="ai-dock ai-dock-v2" hidden={!shown('ai')}>
            <AiPanel
              embedded
              feed={feed}
              selected={selected}
              tab={tab}
              featureName={featureName}
              lang={lang}
              seed={seed}
              open={shown('ai')}
              onSeedConsumed={consumeSeed}
              onClose={closeAi}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
