import { useEffect, useId, useReducer, useRef } from 'react';
import { PERSONAS, PERSONA_PERSPECTIVES } from '../lib/personas.js';

/**
 * F212 (client reference NTER-Final-Developer-Kit top section v5, owner 2026-10-16): the hero's persona
 * column. Six cards in the reference's icon tiles and words; hovering or focusing a card previews its
 * popover, a click keeps it open, and the popover's link opens that persona in the personas section.
 * The reference's Replay button and first-card auto-preview are left out (owner).
 */
const ICONS = {
  policy: ['blue', <path key="p" d="M4 3h11l4 4v14H4zM14 3v5h5M7 17v-3m4 3v-6m4 6v-4M7 9h3" />],
  journalist: ['red', <rect key="r" x="9" y="2" width="6" height="12" rx="3" />, <path key="p" d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v5M8 22h8M11 5h2M11 8h2" />],
  student: ['sand', <path key="p" d="M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2M6 8h4M6 11h4M16 9l1.5 1.5L20 8" />],
  analyst: ['blue', <rect key="r" x="3" y="7" width="18" height="14" rx="2" />, <path key="p" d="M8 7V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 12a23 23 0 0 0 18 0M10 12h4v4h-4z" />],
  lawyer: ['purple', <path key="p" d="M12 3v18M5 21h14M4 7h16M5 7l-3 7h6zM19 7l-3 7h6z" />, <circle key="c" cx="12" cy="5" r="2" />],
  academic: ['sand', <path key="p" d="M2 9l10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v8M21 20l1-3 1 3" />],
};

const CLOSED = { openId: null, pinned: false };

/** The popover's state: which persona is open, and whether a click pinned it. */
export function popoverState(state, event) {
  switch (event.type) {
    case 'hover':
      return state.pinned ? state : { openId: event.id, pinned: false };
    case 'focus':
      return state.openId === event.id ? state : { openId: event.id, pinned: false };
    case 'click':
      return state.pinned && state.openId === event.id ? CLOSED : { openId: event.id, pinned: true };
    case 'leave':
      return state.pinned ? state : CLOSED;
    case 'escape':
    case 'close':
    case 'outside':
      return CLOSED;
    default:
      return state;
  }
}

/**
 * Whether a click moves focus into the popover: only a keyboard click (Enter or Space, `detail` 0) that
 * pinned a card. The popover follows all six cards, so tabbing towards it would open each later card in
 * turn instead.
 */
export const focusAfterClick = (detail, next) => detail === 0 && next.pinned && next.openId !== null;

/** Escape returns focus to the open card only from inside the column; elsewhere it just closes. */
export const returnFocusOnEscape = (focusInColumn) => focusInColumn;

export function PersonaPopover({ id, open, popoverId, titleId, popoverRef, onClose, onExplore }) {
  const p = PERSONA_PERSPECTIVES[id];
  return (
    <section ref={popoverRef} className="nd-persona-popover" id={popoverId} aria-labelledby={titleId} hidden={!open} tabIndex={-1}>
      <button type="button" className="nd-persona-popover-close" aria-label="Close persona preview" onClick={onClose}>×</button>
      <span className="nd-persona-popover-kicker">YOUR NTER PERSPECTIVE</span>
      <h3 id={titleId}>{p.name}</h3>
      <p>{p.description}</p>
      <ul>{p.points.map((text) => <li key={text}>{text}</li>)}</ul>
      <a href="#personas" onClick={(e) => { e.preventDefault(); onExplore(id); }}>
        Explore this perspective <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}

export default function HeroPersonas({ onExplore }) {
  const [state, dispatch] = useReducer(popoverState, CLOSED);
  const columnRef = useRef(null);
  const cards = useRef({});
  const popoverRef = useRef(null);
  const focusPopover = useRef(false);
  const leaveTimer = useRef(0);
  const uid = useId();
  const ids = { heading: `${uid}-heading`, popover: `${uid}-popover`, title: `${uid}-title` };
  const open = state.openId !== null;

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  // After the popover shows: focus it if a keyboard click asked to, and on a phone (where it opens below
  // the cards) bring a pinned one into view.
  useEffect(() => {
    const popover = popoverRef.current;
    if (!state.pinned || !popover) return;
    if (focusPopover.current) popover.focus({ preventScroll: true });
    focusPopover.current = false;
    if (window.matchMedia?.('(max-width: 700px)').matches) popover.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.pinned, state.openId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (returnFocusOnEscape(Boolean(columnRef.current?.contains(document.activeElement)))) cards.current[state.openId]?.focus();
      dispatch({ type: 'escape' });
    };
    const onPress = (e) => {
      if (!columnRef.current?.contains(e.target)) dispatch({ type: 'outside' });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open, state.openId]);

  // A card a mouse click left focused does not hold a preview open; keyboard focus does.
  function onLeave() {
    if (columnRef.current?.querySelector(':focus-visible')) return;
    leaveTimer.current = setTimeout(() => dispatch({ type: 'leave' }), 200);
  }

  function onCardClick(e, id) {
    clearTimeout(leaveTimer.current);
    const next = popoverState(state, { type: 'click', id });
    focusPopover.current = focusAfterClick(e.detail, next);
    dispatch({ type: 'click', id });
  }

  function onBlur() {
    requestAnimationFrame(() => {
      const column = columnRef.current;
      if (column && !column.contains(document.activeElement) && !column.matches(':hover')) dispatch({ type: 'leave' });
    });
  }

  function close() {
    cards.current[state.openId]?.focus();
    dispatch({ type: 'close' });
  }

  function explore(id) {
    dispatch({ type: 'close' });
    onExplore(id);
  }

  return (
    <aside
      ref={columnRef}
      className="nd-persona-column"
      aria-labelledby={ids.heading}
      onPointerEnter={() => clearTimeout(leaveTimer.current)}
      onPointerLeave={onLeave}
      onBlur={onBlur}
    >
      <div className="nd-persona-heading">
        <p className="nd-persona-overline">CURATED FOR</p>
        <h2 id={ids.heading}>Find your <br />perspective<span>.</span></h2>
        <p>One platform. Built around you.</p>
      </div>
      <div className="nd-persona-choices">
        {PERSONAS.map(({ id }, i) => {
          const [tone, ...icon] = ICONS[id];
          const p = PERSONA_PERSPECTIVES[id];
          return (
            <button
              key={id}
              ref={(el) => { cards.current[id] = el; }}
              type="button"
              className="nd-persona-choice"
              data-persona={id}
              style={{ '--reveal-order': i }}
              aria-expanded={state.openId === id}
              aria-controls={ids.popover}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') dispatch({ type: 'hover', id }); }}
              onFocus={() => { clearTimeout(leaveTimer.current); dispatch({ type: 'focus', id }); }}
              onClick={(e) => onCardClick(e, id)}
            >
              <span className={`nd-persona-icon ${tone}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">{icon}</svg>
              </span>
              <span className="nd-persona-choice-copy"><strong>{p.name}</strong><small>{p.tagline}</small></span>
            </button>
          );
        })}
      </div>
      <p className="nd-persona-hint">Choose a role. Discover your view.</p>
      <PersonaPopover
        id={state.openId ?? PERSONAS[0].id}
        open={open}
        popoverId={ids.popover}
        titleId={ids.title}
        popoverRef={popoverRef}
        onClose={close}
        onExplore={explore}
      />
    </aside>
  );
}
