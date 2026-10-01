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
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import './citation-overlay.css';
import { NARROW_QUERY, REDUCED_MOTION_QUERY, nextPhase, overlayShift } from './citationOverlayModel.js';

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

/**
 * Records where the overlay starts from, as CSS custom properties on the overlay itself:
 * `--cov-shift`, the overlay's width less the dock's, and `--cov-top`, the top of the area the
 * dock occupies (below the app's top bars). The dock keeps its grid slot whether the overlay is
 * open or not, so measuring it is safe at any time; a ResizeObserver keeps both current.
 */
function useDockGeometry(node) {
  useLayoutEffect(() => {
    const el = node.current;
    const dock = el?.parentElement;
    if (!el || !dock || typeof window === 'undefined') return undefined;
    const area = dock.parentElement || dock;
    const measure = () => {
      const rect = dock.getBoundingClientRect();
      el.style.setProperty('--cov-shift', `${overlayShift(window.innerWidth, rect.width)}px`);
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
  }, [node]);
}

export default function CitationOverlay({ open, viewer, children, narrow: narrowOverride, reducedMotion: reducedOverride }) {
  const narrow = useMediaQuery(NARROW_QUERY, narrowOverride);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY, reducedOverride);
  const shown = Boolean(open);
  const [phase, setPhase] = useState(() => (shown ? 'open' : 'closed'));
  // Derived during render, so the overlay class and the viewer pane change in the same commit.
  const next = nextPhase(phase, shown, { instant: narrow || reduced });
  if (next !== phase) setPhase(next);

  const node = useRef(null);
  useDockGeometry(node);

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
  const className = `cov${out ? ` is-${phase}` : ''}${out && narrow ? ' is-narrow' : ''}`;
  return (
    <div ref={node} className={className} onTransitionEnd={onTransitionEnd}>
      <div className="cov-chat" inert={out && narrow ? true : undefined}>{children}</div>
      {out ? <div className="cov-viewer">{viewer}</div> : null}
    </div>
  );
}
