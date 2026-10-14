/**
 * Small pieces the Credits usage page, its activity dialog and the small version in Plan & billing
 * share (F153). Hook-free. Every credit figure carries its rupee value (credits x the published
 * rupees per credit), never dollars.
 */
import { formatCredits, rupeeHint } from '../../lib/creditsStore.js';
import { formatTokens, indianNumber, providerName, statusLabel } from '../../lib/creditUsage.js';

/** Credits, with the rupee hint below them when the rate is known. */
export function Credits({ value, rate, negativeNote = false }) {
  const hint = rupeeHint(value, rate);
  return (
    <span className="cu-credits">
      <span className="cu-credits-num">{formatCredits(value)}</span>
      {hint ? <span className="cu-inr">{hint}</span> : null}
      {negativeNote && Number(value) < 0 ? <span className="cu-owed">taken from your next credits</span> : null}
    </span>
  );
}

/** Tokens abbreviated, with the exact Indian-grouped number on hover, focus and for screen readers. */
export function Tokens({ value }) {
  const exact = `${indianNumber(value)} tokens`;
  return (
    <abbr className="cu-tokens" title={exact} aria-label={exact} tabIndex={0}>
      {formatTokens(value)}
    </abbr>
  );
}

/** One figure: a label, the value and an optional line under it. */
export function Figure({ label, children, sub = null }) {
  return (
    <div className="cu-fig">
      <span className="cu-fig-label">{label}</span>
      <span className="cu-fig-value">{children}</span>
      {sub ? <span className="cu-fig-sub">{sub}</span> : null}
    </div>
  );
}

/** A provider's initial in a small badge, named for screen readers. */
export function ProviderMark({ provider }) {
  const name = providerName(provider);
  return (
    <span className="cu-mark" data-provider={provider} title={name} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

export function StatusPill({ status }) {
  return <span className={`cu-pill cu-pill-${status}`}>{statusLabel(status)}</span>;
}

/** The colour dot of a chart series. */
export function Dot({ slot }) {
  return <i className="cu-dot" style={{ background: `var(--cu-s${slot})` }} aria-hidden="true" />;
}

/** A sparkle, for the AI activity header. */
export function SparkleIcon() {
  return (
    <svg className="cu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" />
    </svg>
  );
}

/** A bar chart, for the AI analytics header. */
export function ChartIcon() {
  return (
    <svg className="cu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M4 20h16M7 17V10M12 17V5M17 17v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
