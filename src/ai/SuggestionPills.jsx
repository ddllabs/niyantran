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

export default function SuggestionPills({ questions, onPick, disabled = false, label }) {
  const list = (Array.isArray(questions) ? questions : []).filter((q) => typeof q === 'string' && q.trim());
  if (!list.length) return null;
  return (
    <ul className="ai-suggest ai-v2-suggest" role="list" aria-label={label}>
      {list.map((q) => (
        <li key={q} role="listitem">
          <button type="button" disabled={disabled} onClick={() => onPick?.(q)}>
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}
