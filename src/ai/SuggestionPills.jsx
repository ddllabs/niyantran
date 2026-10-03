/**
 * The question pills under the thread, for both of the things that offer a
 * question: the starters on an empty conversation, and the follow-ups an
 * answer proposes.
 *
 * These were two copies of the same JSX carrying the same class string, and
 * they had drifted - the starters focused the composer after filling it and the
 * follow-ups did not, so clicking a follow-up put text in a box the reader was
 * not looking at. One component, one behaviour.
 *
 * A labelled list (F15): a screen reader announces how many suggestions there
 * are. The items use display: contents so the pills keep their flex layout;
 * the explicit roles keep the list semantics some browsers drop with it.
 *
 * A pill fills the composer rather than sending. The question is a draft the
 * reader can edit, and sending on click would make a mis-tap cost a turn.
 */
import './research.css';

export default function SuggestionPills({ questions, onPick, disabled = false, label, held = false, lang }) {
  const list = (Array.isArray(questions) ? questions : []).filter((q) => typeof q === 'string' && q.trim());
  if (!list.length) return null;
  // held (panel-loading spec C): kept in the layout but hidden and inert while a turn runs, so the
  // row's arrival or departure never shifts the thread.
  return (
    <ul className={`ai-suggest ai-v2-suggest${held ? ' is-held' : ''}`} role="list" aria-label={label} aria-hidden={held ? 'true' : undefined}>
      {list.slice(0, 2).map((q) => (
        <li key={q} role="listitem">
          <button type="button" disabled={disabled || held} tabIndex={held ? -1 : undefined} onClick={() => onPick?.(q)}>
            {q}
          </button>
        </li>
      ))}
      {list.length > 2 ? <li role="listitem" className="ai-suggest-more">
        <details onKeyDownCapture={event => {
          if (event.key !== 'Escape') return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }}>
          <summary tabIndex={held ? -1 : undefined}>{lang === 'hi' ? 'और प्रश्न' : 'More questions'} · {list.length - 2}</summary>
          <div>{list.slice(2).map(q => <button key={q} type="button" disabled={disabled || held} tabIndex={held ? -1 : undefined} onClick={event => {
            event.currentTarget.closest('details').open = false;
            onPick?.(q);
          }}>{q}</button>)}</div>
        </details>
      </li> : null}
    </ul>
  );
}
