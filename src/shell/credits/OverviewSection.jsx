/**
 * The credits page's Overview (F184 spec §1, §3): how much is left and how fast it is going. This
 * period's bar, the pace against an even month, where the credits went, this period's figures, the
 * latest answers and the credits by expiry. Hook-free: CreditsPage reads the reports.
 */
import { creditsText, formatCredits } from '../../lib/creditsStore.js';
import { indianNumber, modelLabel, rowChat, whenText } from '../../lib/creditUsage.js';
import { periodLine } from '../../lib/creditsVisual.js';
import CreditLots from '../CreditLots.jsx';
import { Tokens } from '../usage/usageParts.jsx';
import { PaceChart, PeriodBar, WhereCreditsWent } from './CreditsVisuals.jsx';
import { goAccount } from './accountRoute.js';

function RecentAnswers({ state, onOpenChat }) {
  if (state.status === 'loading') return <p className="cu-note" role="status">Loading your latest answers…</p>;
  if (state.status === 'error') return <p className="cu-note cu-error" role="alert">Your latest answers could not be loaded just now.</p>;
  if (!state.rows.length) return <p className="cu-note">No answers yet. Ask the research assistant anything about a record.</p>;
  const max = Math.max(...state.rows.map((r) => r.credits || 0), 0);
  return (
    <ul className="cp-rows cp-rows-compact">
      {state.rows.map((r, i) => (
        <li key={r.turnKey || i} className="cp-row">
          <div className="cp-row-main">
            <div className="cp-row-text">
              {r.conversationId
                ? <button type="button" className="cp-row-q cp-row-link" onClick={() => onOpenChat(r.conversationId)}>{r.question || rowChat(r)}</button>
                : <p className="cp-row-q">{r.question || rowChat(r)}</p>}
              <p className="cp-row-meta"><span>{whenText(r.createdAt)}</span><span className="cp-chip" title={r.model || ''}>{r.model ? modelLabel(r.model) : 'No model'}</span>{r.status === 'failed' ? <span>Failed · not charged</span> : null}</p>
            </div>
            <span className="cp-mini" aria-hidden="true"><span className="cp-s0" style={{ width: `${max > 0 ? Math.round((100 * r.credits) / max) : 0}%` }} /></span>
            <span className="cp-row-credits">{formatCredits(r.credits)}<span className="cu-sr"> credits</span></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewSection({ credits, creditsFailed, cycle, series, recent, onOpenChat, now = Date.now() }) {
  if (!credits) {
    return <p className="cu-note" role={creditsFailed ? 'alert' : 'status'}>{creditsFailed ? 'Your credits could not be loaded just now.' : 'Loading your credits…'}</p>;
  }
  const summary = cycle.summary;
  const left = Math.max(credits.balance - (credits.held || 0), 0);
  const ofTotal = Math.max((credits.usedThisCycle || 0) + Math.max(credits.balance, 0), 0);
  const ends = Date.parse(credits.cycleEndsAt || '');
  const daysLeft = Number.isFinite(ends) && ends > now ? Math.ceil((ends - now) / 86400000) : null;
  return (
    <div className="cp-stack">
      <section className="cp-card cp-hero" aria-labelledby="cp-left-title">
        <div className="cp-hero-head">
          <h3 id="cp-left-title" className="cp-big">{formatCredits(left)}<span className="cu-sr"> credits left</span></h3>
          <p className="cp-hero-sub">credits left{ofTotal ? ` of ${formatCredits(ofTotal)} this period` : ''}</p>
          <p className="cp-hero-when">{daysLeft !== null ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to renewal` : periodLine(credits)}</p>
        </div>
        <PeriodBar credits={credits} />
        <dl className="cp-facts">
          <div><dt>Model calls this period</dt><dd>{summary ? indianNumber(summary.calls) : '—'}{summary?.failedCalls ? <span className="cp-dim"> · {summary.failedCalls} failed</span> : null}</dd></div>
          <div><dt>Tokens this period</dt><dd>{summary ? <Tokens value={summary.tokens} /> : '—'}</dd></div>
          <div><dt>Lifetime spend</dt><dd>{summary ? creditsText(summary.lifetimeCredits) : '—'}</dd></div>
        </dl>
      </section>

      <div className="cp-split">
        <section className="cp-card" aria-labelledby="cp-pace-title">
          <div className="cp-card-head"><h3 id="cp-pace-title" className="cp-card-title">Pace this period</h3><p className="cp-dim">Used so far, against an even pace</p></div>
          {series.status === 'error' ? <p className="cu-note cu-error" role="alert">The pace could not be loaded just now.</p>
            : series.status === 'loading' ? <p className="cu-note" role="status">Loading the pace…</p>
              : <PaceChart credits={credits} points={series.points} now={now} />}
        </section>
        <section className="cp-card" aria-labelledby="cp-where-title">
          <div className="cp-card-head"><h3 id="cp-where-title" className="cp-card-title">Where your credits went</h3><button type="button" className="cp-link" onClick={() => goAccount('usage')}>Full breakdown</button></div>
          {cycle.status === 'error' ? <p className="cu-note cu-error" role="alert">This period's usage could not be loaded just now.</p>
            : !summary ? <p className="cu-note" role="status">Loading this period…</p>
              : <WhereCreditsWent summary={summary} />}
        </section>
      </div>

      <div className="cp-split">
        <section className="cp-card" aria-labelledby="cp-recent-title">
          <div className="cp-card-head"><h3 id="cp-recent-title" className="cp-card-title">Recent answers</h3><button type="button" className="cp-link" onClick={() => goAccount('activity')}>All activity</button></div>
          <RecentAnswers state={recent} onOpenChat={onOpenChat} />
        </section>
        <section className="cp-card" aria-labelledby="cp-lots-title">
          <div className="cp-card-head"><h3 id="cp-lots-title" className="cp-card-title">Credits by expiry</h3></div>
          <CreditLots lots={credits.lots} />
        </section>
      </div>
    </div>
  );
}
