import { ArrowUp, Square } from 'lucide-react';

/** One stable hit target, including pending cancellation. */
export default function ChatSubmit({ canStop, stopping, cancelPending, disabled, onStop, lang }) {
  const hi = lang === 'hi';
  const label = canStop ? (stopping ? (hi ? 'रुक रहा है' : 'Stopping') : (hi ? 'रोकें' : 'Stop')) : (hi ? 'भेजें' : 'Send');
  return <button
    type={canStop ? 'button' : 'submit'}
    className={`ai-v2-send${canStop ? ' stop' : ''}`}
    aria-label={label} title={label}
    disabled={canStop ? Boolean(stopping || cancelPending) : disabled}
    onClick={canStop ? onStop : undefined}
  >
    <ArrowUp className="ai-submit-arrow" size={20} strokeWidth={2.2} aria-hidden="true" />
    <Square className="ai-submit-square" size={14} fill="currentColor" aria-hidden="true" />
  </button>;
}
