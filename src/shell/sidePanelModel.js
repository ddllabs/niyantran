/**
 * The side panel's pure rules (docs/specs/2026-10-03-side-panel.md): which of Desk, Record and AI
 * exist, which is active, whether the panel is open or collapsed, and its docked width.
 * SidePanel.jsx applies them.
 */
import { keyStep, readStoredNumber, size, within } from './resizeModel.js';

/* ─── Tabs ─────────────────────────────────────────────────────────────────────────────────── */

export const COLLAPSED_STORAGE_KEY = 'niyantranSidePanelCollapsed';

/**
 * Desk and Record exist where the rail showed before (`hasRail`); Record only while a row is
 * selected. AI exists everywhere.
 */
export function availableTabs({ hasRail, selected }) {
  if (!hasRail) return ['ai'];
  return selected ? ['desk', 'record', 'ai'] : ['desk', 'ai'];
}

const mount = (mounted, tab) => (tab && !mounted.includes(tab) ? [...mounted, tab] : mounted);
const railTab = (selected) => (selected ? 'record' : 'desk');

/** Opens on Desk (or Record) where there is a rail, and hidden where there is not, until AI opens. */
export function initialPanel({ hasRail, selected, collapsed = false }) {
  const active = hasRail ? railTab(selected) : null;
  return { active, open: Boolean(hasRail) && !collapsed, collapsed: Boolean(collapsed), mounted: active ? [active] : [] };
}

/**
 * The next panel state. `ctx` is the desk as it now is: `{ hasRail, selected }`. The mounted set
 * only grows: a tab once shown stays mounted (hidden), so AI keeps its thread and the others their
 * scroll.
 */
export function panelReducer(state, action, ctx) {
  const tabs = availableTabs(ctx);
  switch (action.type) {
    case 'select': {
      // On AI the chat is not interrupted; Record simply becomes available.
      if (!ctx.hasRail || state.active === 'ai') return state;
      return { ...state, active: 'record', mounted: mount(state.mounted, 'record') };
    }
    case 'clear':
      return state.active === 'record' ? { ...state, active: 'desk', mounted: mount(state.mounted, 'desk') } : state;
    case 'ai-open':
      return { ...state, active: 'ai', open: true, collapsed: false, mounted: mount(state.mounted, 'ai') };
    case 'tab':
      if (!tabs.includes(action.tab) || state.active === action.tab) return state;
      return { ...state, active: action.tab, mounted: mount(state.mounted, action.tab) };
    case 'collapse':
      return { ...state, open: false, collapsed: true };
    case 'reopen': {
      const active = tabs.includes(action.tab) ? action.tab : tabs.includes(state.active) ? state.active : tabs[0];
      return { ...state, active, open: true, collapsed: false, mounted: mount(state.mounted, active) };
    }
    case 'close-ai': {
      if (!ctx.hasRail) return { ...state, open: false };
      const active = railTab(ctx.selected);
      return { ...state, active, mounted: mount(state.mounted, active) };
    }
    case 'context': {
      // A desk or module change. Off a rail desk only AI can stay; onto one, the panel shows
      // Desk (or Record) unless AI is in use or the reader collapsed it.
      if (!ctx.hasRail) {
        const onAi = state.active === 'ai' && state.open;
        return { ...state, active: onAi ? 'ai' : null, open: onAi };
      }
      if (state.active === 'ai' && state.open) return state;
      const active = railTab(ctx.selected);
      return { ...state, active, open: !state.collapsed, mounted: mount(state.mounted, active) };
    }
    default:
      return state;
  }
}

/** The collapsed choice; false for nothing, junk or a storage that throws. */
export function readStoredCollapsed(storage) {
  try {
    return storage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/* ─── Docked width (owner decision 1: 36% by default, 340 px to 60%) ─────────────────────────── */

export const PANEL_WIDTH_STORAGE_KEY = 'niyantranSidePanelWidth';
export const PANEL_DEFAULT_PCT = 36;
export const PANEL_MIN_PX = 340;
export const PANEL_MAX_PCT = 60;
export const PANEL_KEY_STEP_PX = 16;

/** 340 px (or the workspace, if narrower) to 60% of the workspace; never max < min. */
export function panelBounds(workspaceWidth) {
  const ws = size(workspaceWidth);
  const min = Math.min(ws, PANEL_MIN_PX);
  return { min, max: Math.max(min, Math.round((ws * PANEL_MAX_PCT) / 100)) };
}

/** A width clamped to the bounds in whole pixels; a non-number gives the default. */
export function clampPanelWidth(value, workspaceWidth) {
  if (!Number.isFinite(value)) return defaultPanelWidth(workspaceWidth);
  const { min, max } = panelBounds(workspaceWidth);
  return Math.round(within(value, min, max));
}

export function defaultPanelWidth(workspaceWidth) {
  return clampPanelWidth(Math.round((size(workspaceWidth) * PANEL_DEFAULT_PCT) / 100), workspaceWidth);
}

/** The chosen width (null: none, so it follows the workspace) clamped to the current workspace. */
export function resolvePanelWidth(chosen, workspaceWidth) {
  return chosen == null ? defaultPanelWidth(workspaceWidth) : clampPanelWidth(chosen, workspaceWidth);
}

/** The handle is the panel's left edge, so moving the pointer left widens it. */
export const dragPanelWidth = (startWidth, startX, x, workspaceWidth) => clampPanelWidth(startWidth + (startX - x), workspaceWidth);

export function stepPanelWidth(width, key, { shift = false, workspaceWidth } = {}) {
  const { min, max } = panelBounds(workspaceWidth);
  const next = keyStep(width, key, shift, PANEL_KEY_STEP_PX, min, max);
  return next === null ? null : clampPanelWidth(next, workspaceWidth);
}

/** The stored width, re-clamped to the workspace when it is known. */
export function readStoredPanelWidth(storage, workspaceWidth) {
  const value = readStoredNumber(storage, PANEL_WIDTH_STORAGE_KEY);
  if (value === null) return null;
  return size(workspaceWidth) ? clampPanelWidth(value, workspaceWidth) : value;
}
