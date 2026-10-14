/**
 * Section A of the Credits usage page (F153): this billing period at a glance. Hook-free.
 * `state` is {status: 'loading' | 'error' | 'ready', summary} for my_usage_summary over the cycle
 * (my_credits().cycle.starts_at to now; lifetime when there is no cycle).
 */
import { creditsText, formatCredits, rupeeHint } from '../../lib/creditsStore.js';
import { dayText, indianNumber, modelName, providerOf } from '../../lib/creditUsage.js';
import { Credits, Figure, ProviderMark, SparkleIcon, Tokens } from './usageParts.jsx';

export function periodLine(credits) {
  if (!credits) return '';
  const ends = dayText(credits.cycleEndsAt);
  if (credits.plan === 'free') return ends ? `Sign-up credits · valid until ${ends}` : 'Sign-up credits';
  const starts = dayText(credits.cycleStartsAt);
  if (starts && ends) return `Billing period · ${starts} – ${ends} · renews ${ends}`;
  return ends ? `Billing period · renews ${ends}` : 'Billing period';
}

/** The four figures, shared with the small version in Plan & billing. */
export function CycleFigures({ credits, summary, compact = false }) {
  const rate = credits?.inrPerCredit;
  const allowance = credits?.allowance;
  return (
    <div className={`cu-figs${compact ? ' cu-figs-compact' : ''}`}>
      <Figure label="Credits used"><Credits value={summary?.credits ?? 0} rate={rate} /></Figure>
      <Figure label="Credits left" sub={allowance ? `of ${formatCredits(allowance)} this period` : null}>
        <Credits value={credits?.balance ?? 0} rate={rate} negativeNote />
      </Figure>
      <Figure label="Model calls">{indianNumber(summary?.calls ?? 0)}</Figure>
      <Figure label="Tokens"><Tokens value={summary?.tokens ?? 0} /></Figure>
    </div>
  );
}

/** Up to three models, most credits first: id, then "N calls · N credits". */
export function TopModels({ models, rate }) {
  const top = (models || []).slice(0, 3);
  if (!top.length) return <p className="cu-note">No model calls yet.</p>;
  return (
    <ul className="cu-top">
      {top.map((m) => (
        <li key={m.model} className="cu-top-row">
          <span className="cu-top-name" title={m.model}>
            <ProviderMark provider={providerOf(m.model)} />
            {modelName(m.model)}
          </span>
          <span className="cu-top-num">
            {indianNumber(m.calls)} {m.calls === 1 ? 'call' : 'calls'} · {creditsText(m.credits)}
            {rupeeHint(m.credits, rate) ? <span className="cu-inr"> {rupeeHint(m.credits, rate)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function UsageActivityCard({ credits, state, onViewAll, viewAllRef }) {
  const summary = state?.summary || null;
  const rate = credits?.inrPerCredit;
  const noCycle = Boolean(credits) && !credits.cycleStartsAt;
  return (
    <section className="cu-card" aria-labelledby="cu-activity-title">
      <header className="cu-card-head">
        <h3 id="cu-activity-title"><SparkleIcon /> AI activity</h3>
        <p className="cu-sub">{noCycle ? 'No credits period is open · lifetime figures' : periodLine(credits)}</p>
      </header>
      {!credits || state?.status === 'loading' ? (
        <p className="cu-note" role="status">Loading your usage…</p>
      ) : state?.status === 'error' ? (
        <p className="cu-note cu-error" role="alert">Your usage could not be loaded just now.</p>
      ) : (
        <>
          <CycleFigures credits={credits} summary={summary} />
          <p className="cu-lifetime">
            Lifetime spend: <strong>{creditsText(summary?.lifetimeCredits ?? 0)}</strong>
            {rupeeHint(summary?.lifetimeCredits ?? 0, rate) ? <span className="cu-inr"> ({rupeeHint(summary?.lifetimeCredits ?? 0, rate)})</span> : null}
          </p>
          <h4 className="cu-h4">Top models · this billing period</h4>
          <TopModels models={summary?.byModel} rate={rate} />
        </>
      )}
      <button type="button" className="cu-link" ref={viewAllRef} onClick={() => onViewAll?.()}>
        View all AI activity <span aria-hidden="true">↗</span>
      </button>
    </section>
  );
}
