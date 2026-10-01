/**
 * The citation overlay (docs/specs/2026-10-01-rag-v2-citations-pdf.md, decision 7 and Design >
 * Layout). Closed, it is a plain wrapper and the chat sits in the dock as before. Open, the same
 * element turns `position: fixed`, right-anchored and max(50vw, 960px) wide, with the chat on the
 * left half and the viewer on the right; it slides out from the dock and back in about 250 ms.
 *
 * Why not a portal: moving the chat into a portal changes its parent, which remounts AiPanel and
 * its research hook and would drop the draft, the attachments and a streaming answer. Expanding
 * the wrapper in place keeps the chat at the same place in the tree. No ancestor of the dock
 * (.terminal, .workspace, .ai-dock) has a transform, filter or containment, so the fixed box is
 * placed against the viewport, and the dock keeps its grid track, so the desk is not reflowed.
 *
 * Phones (the 900 px breakpoint at which the dock stacks under the desk): the chat stays where it
 * is and the viewer pane alone is fixed over the app area; the hidden chat is inert meanwhile.
 * No focus is trapped on wider screens. Esc and "← Back" are WorkSurface's.
 *
 * Resizing (revision 4, point 1; desktop and the open state only): the outer left edge sets the
 * overlay's width and the divider between the chat and the viewer sets the viewer's share. Both
 * are separators that take pointer drags (captured, so mouse, touch and pen) and the arrow, Home
 * and End keys, reset on double-click, and are remembered per browser. The width and share reach
 * the CSS as --cov-width and --cov-split; the maths is in citationOverlayModel.js.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import './citation-overlay.css';
import {
  NARROW_QUERY, REDUCED_MOTION_QUERY, SPLIT_MAX, SPLIT_MIN, SPLIT_STORAGE_KEY, WIDTH_STORAGE_KEY, dragSplit, dragWidth,
  nextPhase, overlayShift, readStoredSplit, readStoredWidth, resolveSplit, resolveWidth, stepSplit, stepWidth,
  widthBounds, writeStored,
} from './citationOverlayModel.js';

/** The fallback in case transitionend never arrives (a hidden tab, an interrupted transition). */
const SETTLE_MS = 450;

const mediaList = query => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

function useMediaQuery(query, override) {
  // Stable per query, so AiPanel's frequent renders (a streaming answer) do not resubscribe.
  const subscribe = useCallback((onChange) => {
    const list = mediaList(query);
    list?.addEventListener?.('change', onChange);
    return () => list?.removeEventListener?.('change', onChange);
  }, [query]);
  const matches = useSyncExternalStore(subscribe, () => Boolean(mediaList(query)?.matches), () => false);
  return typeof override === 'boolean' ? override : matches;
}

const subscribeResize = (onChange) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/** window.innerWidth, kept current; 0 (unknown) when rendered without a window. */
function useViewportWidth(override) {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 0);
  return Number.isFinite(override) ? override : width;
}

/** The storage given for tests, else localStorage, else null (blocked, or no window). */
function storageOf(override) {
  if (override !== undefined) return override;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Records where the overlay starts from, as CSS custom properties on the overlay itself:
 * `--cov-shift`, the overlay's current width less the dock's, and `--cov-top`, the top of the
 * area the dock occupies (below the app's top bars). The dock keeps its grid slot whether the
 * overlay is open or not, so measuring it is safe at any time; a ResizeObserver keeps both
 * current, and a new overlay width re-measures, so the slide back starts from that width.
 */
function useDockGeometry(node, width) {
  useLayoutEffect(() => {
    const el = node.current;
    const dock = el && el.parentElement;
    if (!dock) return undefined;
    const area = dock.parentElement || dock;
    const measure = () => {
      const rect = dock.getBoundingClientRect();
      el.style.setProperty('--cov-shift', `${overlayShift(window.innerWidth, rect.width, width)}px`);
      el.style.setProperty('--cov-top', `${Math.max(0, Math.round(area.getBoundingClientRect().top))}px`);
    };
    measure();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    if (area !== dock) observer.observe(area);
    return () => observer.disconnect();
  }, [node, width]);
}

/**
 * The two separators, `edge` (the width, px) and `divider` (the viewer's share, %): the chosen
 * values (null: none, so the defaults apply and the width tracks the viewport), their drags, keys
 * and double-click resets, and their storage. A drag writes storage once, when it ends.
 */
function useOverlaySize(vw, storageOverride, active) {
  const [storage] = useState(() => storageOf(storageOverride));
  const [chosen, setChosen] = useState(() => ({ edge: readStoredWidth(storage, vw), divider: readStoredSplit(storage) }));
  const [resizing, setResizing] = useState(null);
  const drag = useRef(null);
  const now = { edge: resolveWidth(chosen.edge, vw), divider: resolveSplit(chosen.divider) };

  // The handles unmount when the overlay closes or the screen turns narrow: drop any drag.
  useEffect(() => {
    if (active) return;
    drag.current = null;
    setResizing(null);
  }, [active]);

  const set = (kind, value, persist) => {
    setChosen(c => ({ ...c, [kind]: value }));
    if (persist) writeStored(storage, kind === 'edge' ? WIDTH_STORAGE_KEY : SPLIT_STORAGE_KEY, value);
  };

  const handle = kind => ({
    onPointerDown(e) {
      if (e.button) return; // a mouse's main button; touch and pen contacts report 0
      e.preventDefault(); // no text selection while dragging
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind, id: e.pointerId, x: e.clientX, start: now[kind], px: e.currentTarget.parentNode.offsetWidth, value: null };
      setResizing(kind);
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d || d.kind !== kind || d.id !== e.pointerId) return;
      d.value = kind === 'edge' ? dragWidth(d.start, d.x, e.clientX, vw) : dragSplit(d.start, d.x, e.clientX, d.px);
      set(kind, d.value);
    },
    // Fires after pointerup and pointercancel alike, once the capture is released.
    onLostPointerCapture() {
      const d = drag.current;
      if (!d || d.kind !== kind) return;
      drag.current = null;
      setResizing(null);
      if (d.value !== null) set(kind, d.value, true);
    },
    onDoubleClick: () => set(kind, null, true),
    onKeyDown(e) {
      const next = kind === 'edge'
        ? stepWidth(now.edge, e.key, { shift: e.shiftKey, viewportWidth: vw })
        : stepSplit(now.divider, e.key, { shift: e.shiftKey });
      if (next === null) return;
      e.preventDefault();
      set(kind, next, true);
    },
  });

  return { width: now.edge, split: now.divider, resizing, handle };
}

export default function CitationOverlay({
  open, viewer, children, narrow: narrowOverride, reducedMotion: reducedOverride, viewportWidth, storage,
}) {
  const narrow = useMediaQuery(NARROW_QUERY, narrowOverride);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY, reducedOverride);
  const vw = useViewportWidth(viewportWidth);
  const shown = Boolean(open);
  const [phase, setPhase] = useState(() => (shown ? 'open' : 'closed'));
  // Derived during render, so the overlay class and the viewer pane change in the same commit.
  const next = nextPhase(phase, shown, { instant: narrow || reduced });
  if (next !== phase) setPhase(next);

  const node = useRef(null);
  const handles = phase === 'open' && !narrow;
  const { width, split, resizing, handle } = useOverlaySize(vw, storage, handles);
  useDockGeometry(node, width);

  // FLIP: `opening` places the overlay at its start position without a transition; reading the
  // layout commits that position, and `open` then transitions it to rest before the first paint.
  useLayoutEffect(() => {
    if (phase !== 'opening') return;
    node.current?.getBoundingClientRect();
    setPhase((p) => (p === 'opening' ? 'open' : p));
  }, [phase]);

  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const timer = setTimeout(() => setPhase((p) => (p === 'closing' ? 'closed' : p)), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const onTransitionEnd = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    setPhase((p) => (p === 'closing' ? 'closed' : p));
  };

  const out = phase !== 'closed';
  // An unknown viewport (no window) leaves the width and the halves to the CSS fallbacks.
  const sized = out && !narrow && width > 0;
  const className = `cov${out ? ` is-${phase}` : ''}${out && narrow ? ' is-narrow' : ''}${handles && resizing ? ' is-resizing' : ''}`;
  const style = sized ? { '--cov-width': `${width}px`, '--cov-split': `${split}%` } : undefined;
  const bounds = widthBounds(vw);
  const separator = (kind, label, min, max, now) => (
    <div
      className={`cov-${kind}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={now}
      tabIndex={0}
      {...handle(kind)}
    />
  );
  // The chat stays the first child in every state, so it is never remounted; the handles and the
  // viewer only follow it (the divider before the viewer, matching the tab order to the layout).
  return (
    <div ref={node} className={className} style={style} onTransitionEnd={onTransitionEnd}>
      <div className="cov-chat" inert={out && narrow ? true : undefined}>{children}</div>
      {handles ? separator('edge', 'Resize the citation panel', bounds.min, bounds.max, width) : null}
      {handles ? separator('divider', 'Resize the chat and the source viewer', SPLIT_MIN, SPLIT_MAX, Math.round(split)) : null}
      {out ? <div className="cov-viewer">{viewer}</div> : null}
    </div>
  );
}
