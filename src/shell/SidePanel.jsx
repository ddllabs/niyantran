import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import AiPanel from '../ai/AiPanel.jsx';
import PanelOverlay from './PanelOverlay.jsx';
import RailContent, { railClasses } from './RailContent.jsx';
import {
  PANEL_WIDTH_STORAGE_KEY, availableTabs, dragPanelWidth, initialPanel, panelBounds, panelReducer, readStoredPanelWidth, resolvePanelWidth, stepPanelWidth,
} from './sidePanelModel.js';
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
/** The form a narrow bar shows (a container query on the bar picks it); the full name stays the label. */
const SHORT = { ai: ['AI', 'एआई'] };
const label = (tab, hi) => LABELS[tab][hi ? 1 : 0];
const shortLabel = (tab, hi) => (SHORT[tab] || LABELS[tab])[hi ? 1 : 0];
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
    () => initialPanel(ctx),
  );
  const [seen, setSeen] = useState({ selected, hasRail, featureName });
  if (seen.selected !== selected || seen.hasRail !== hasRail || seen.featureName !== featureName) {
    setSeen({ selected, hasRail, featureName });
    if (seen.hasRail !== hasRail || seen.featureName !== featureName) dispatch({ type: 'context', ctx });
    else if (selected) dispatch({ type: 'select', ctx });
    else dispatch({ type: 'clear', ctx });
  }

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

  // The expand mode (spec point 3): the reader's Expand, on any tab, or a citation open in AI.
  const [userExpanded, setUserExpanded] = useState(false);
  const [citation, setCitation] = useState({ open: false, closeAll: null });
  const citationExpanded = aiActive && citation.open;
  const expanded = state.open && !(hasRail && state.collapsed) && (userExpanded || citationExpanded);

  const keyState = useRef({});
  keyState.current = { aiActive, userExpanded, citationExpanded };
  useEffect(() => {
    if (!aiActive && !userExpanded) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      const k = keyState.current;
      // A citation's Esc is the viewer's own (WorkSurface). Otherwise Esc first restores an
      // expanded panel, and then, on AI, closes it as the dock's Esc did.
      if (k.userExpanded && !k.citationExpanded) setUserExpanded(false);
      else if (k.aiActive) dispatch({ type: 'close-ai', ctx: ctxRef.current });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [aiActive, userExpanded]);

  // The docked width (spec point 2): the reader's choice in px, or null for the default. The shell
  // hands it to the grid as --panel-chosen; CSS clamps it to 400 px and 60% on every resize.
  const [width, setWidthState] = useState(() => readStoredPanelWidth(storage(), 0));
  const setWidth = useCallback((px) => {
    setWidthState(px);
    writeStored(storage(), PANEL_WIDTH_STORAGE_KEY, px);
  }, []);

  const act = useCallback((action) => dispatch({ ...action, ctx: ctxRef.current }), []);
  const consumeSeed = useCallback(() => setSeed(null), []);
  return {
    state, act, seed, consumeSeed, aiOpen: aiActive, collapsed: hasRail && state.collapsed, width, setWidth,
    expanded, userExpanded, setUserExpanded, citation, setCitation, citationExpanded,
  };
}

export default function SidePanel({ panel, hasRail, feed, selected, onSelect, lang, loading, vizFilter, tab, featureName }) {
  const { state, act, seed, consumeSeed, width, setWidth, expanded, userExpanded, setUserExpanded, setCitation, citation, citationExpanded } = panel;
  const [viewerSlot, setViewerSlot] = useState(null);
  const [actionsSlot, setActionsSlot] = useState(null);
  const onCitation = useCallback((open, closeAll) => setCitation({ open, closeAll }), [setCitation]);
  // A click outside the expanded panel: with a citation open it closes the citation and the chat
  // (revision 5); otherwise it only restores the panel.
  const onOutside = useCallback(() => {
    if (citationExpanded) citation.closeAll?.();
    else setUserExpanded(false);
  }, [citationExpanded, citation, setUserExpanded]);
  const hi = lang === 'hi';
  const asideRef = useRef(null);
  const drag = useRef(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  useEffect(() => {
    const workspace = asideRef.current?.parentElement;
    const update = () => setWorkspaceWidth(Math.round(workspace?.getBoundingClientRect().width || 0));
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (workspace) observer?.observe(workspace);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const bounds = panelBounds(workspaceWidth);
  const currentWidth = resolvePanelWidth(width ?? null, workspaceWidth);
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

  // The left edge resizes the panel on every tab (spec point 2). A drag writes the grid's variable
  // directly, so the desk is not re-rendered on every move; the width is kept when it ends.
  const workspace = () => asideRef.current?.parentElement ?? null;
  const measure = (el) => Math.round(el?.getBoundingClientRect().width || 0);
  const edge = {
    onPointerDown(e) {
      if (e.button) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { start: measure(asideRef.current), x: e.clientX, ws: measure(workspace()), px: null };
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d) return;
      d.px = dragPanelWidth(d.start, d.x, e.clientX, d.ws);
      workspace()?.style.setProperty('--panel-chosen', `${d.px}px`);
      e.currentTarget.setAttribute('aria-valuenow', String(d.px));
      e.currentTarget.setAttribute('aria-valuetext', `${d.px} px`);
    },
    onPointerUp() {
      const d = drag.current;
      drag.current = null;
      if (d?.px != null) setWidth(d.px);
    },
    onKeyDown(e) {
      const next = stepPanelWidth(measure(asideRef.current), e.key, { shift: e.shiftKey, workspaceWidth: measure(workspace()) });
      if (next === null) return;
      e.preventDefault();
      setWidth(next);
    },
    onDoubleClick() {
      setWidth(null);
    },
  };
  edge.onPointerCancel = edge.onPointerUp;

  return (
    <aside
      ref={asideRef}
      className={`side-panel${state.active === 'ai' ? ' is-ai' : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={hi ? 'साइड पैनल' : 'Side panel'}
      hidden={!state.open && !collapsed}
    >
      {state.open && !collapsed && !expanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={hi ? 'पैनल का आकार बदलें' : 'Resize the panel'}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={currentWidth}
          aria-valuetext={width ? `${width} px` : hi ? 'डिफ़ॉल्ट चौड़ाई' : 'Default width'}
          tabIndex={0}
          className="side-panel-edge"
          title={hi ? 'खींचें; डबल-क्लिक से रीसेट' : 'Drag to resize; double-click to reset'}
          {...edge}
        />
      ) : null}
      <PanelOverlay open={expanded} split={citationExpanded} viewerRef={setViewerSlot} onOutside={onOutside}>
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
                aria-label={label(t, hi)}
              >
                <span className="tab-long">{label(t, hi)}</span>
                <span className="tab-short" aria-hidden="true">{shortLabel(t, hi)}</span>
              </button>
            ))}
          </div>
          {/* The active tab's own actions (amendment 2): AI portals its toolbar here. */}
          <div className="side-panel-tab-actions" ref={setActionsSlot} hidden={state.active !== 'ai'} />
          <div className="side-panel-actions">
            <button
              type="button"
              className={`side-panel-expand${expanded ? ' on' : ''}`}
              onClick={() => setUserExpanded(!userExpanded)}
              disabled={citationExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? (hi ? 'पैनल सामान्य करें' : 'Restore the panel') : hi ? 'पैनल बड़ा करें' : 'Expand the panel'}
              title={expanded ? (hi ? 'सामान्य करें' : 'Restore') : hi ? 'बड़ा करें' : 'Expand'}
            >
              <span aria-hidden="true">{expanded ? '⇲' : '⇱'}</span>
            </button>
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
              onCitation={onCitation}
              viewerSlot={viewerSlot}
              actionsSlot={actionsSlot}
            />
          </div>
        ) : null}
      </div>
      </PanelOverlay>
    </aside>
  );
}
