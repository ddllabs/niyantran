import { useEffect, useState } from 'react';
import {
  hydrateAppFlags,
  isTestingPhase,
  subscribeAppFlags,
} from '../lib/appFlagsStore.js';
import { loadPricing, PLAN_IDS, subscribePricing } from '../lib/pricingStore.js';

function Ico({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Tick({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 8.2l3.1 3.1 6.5-6.6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CircCheck({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.25" fill="none" stroke={color} strokeWidth="1.35" />
      <path d="M5.4 9.2l2.3 2.3 5-5.1" fill="none" stroke={color} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const C = {
  blue: '#012ea1',
  purple: '#4f1d90',
  red: '#c81322',
};

const PERKS = [
  { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.2 12.1l2.4 2.4 5.2-5.4', title: 'Secure & Compliant', copy: 'Enterprise-grade security and data protection' },
  { d: 'M13 2L4 14h7l-1 8 10-14h-7l1-8z', title: 'Real-Time Intelligence', copy: 'Live, authoritative data from 200+ sources' },
  { d: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', title: 'Built for Collaboration', copy: 'Share insights and work together seamlessly' },
  { d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18', title: 'Global Coverage', copy: 'Comprehensive coverage across regions and sectors' },
];

const COMPARE = [
  ['Access to Desks', '5 Core Desks', 'All Desks', 'All Desks', 'All Desks'],
  ['Real-Time Data Feeds', 'Limited', true, true, true],
  ['Custom Dashboards', 'Up to 3', 'Up to 10', 'Unlimited', 'Unlimited'],
  ['AI Research Assistant', false, false, true, true],
  ['API Access', false, false, true, true],
  ['Data Exports', false, true, true, true],
  ['Team Collaboration', false, true, true, true],
  ['Support', 'Community', 'Priority', 'SLA Support', 'Dedicated'],
  ['Deployment', 'Cloud', 'Cloud', 'Cloud', 'Private Cloud / On-Prem'],
];

const COL_COLOR = [C.blue, C.purple, C.blue, C.red];

/** Single public plan while admin testing-phase flag is on (Explorer look, full access). */
const OPEN_PLAN = {
  id: 'explorer',
  name: 'EXPLORER',
  who: 'For individuals and researchers',
  monthly: 0,
  yearly: 0,
  unit: '/month',
  tag: 'Every desk, full coverage, and AI research — at no cost.',
  cta: 'Get Started Free',
  ctaKind: 'ghost-blue',
  color: C.blue,
  popular: false,
  plus: null,
  items: [
    'Access to all desks',
    'Full data coverage',
    'Export & copy',
    'AI research assistant (Gemini)',
    'Community support',
  ],
};

function Cell({ value, color }) {
  if (value === true) return <CircCheck color={color} />;
  if (value === false) return <span className="mkt-pr-dash">—</span>;
  return <span>{value}</span>;
}

function onCardMove(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`);
}

export default function PricingPage({ onLogin }) {
  const [yearly, setYearly] = useState(false);
  const [focus, setFocus] = useState(null);
  const [plans, setPlans] = useState(() => loadPricing());
  const [singleTier, setSingleTier] = useState(() => isTestingPhase());

  useEffect(() => subscribePricing(setPlans), []);
  useEffect(() => {
    hydrateAppFlags().then((f) => setSingleTier(Boolean(f.testingPhase)));
    return subscribeAppFlags((f) => setSingleTier(Boolean(f.testingPhase)));
  }, []);

  const displayPlans = singleTier ? [OPEN_PLAN] : plans;

  function goPlan(planId) {
    if (planId === 'gov') {
      onLogin?.('signup');
      return;
    }
    onLogin?.(planId);
  }

  return (
    <div className={`mkt-pr${singleTier ? ' is-open' : ''}`}>
      <div className="mkt-pr-art" aria-hidden="true">
        <span className="mkt-pr-scan" />
        <span className="mkt-pr-gridlines" />
        <span className="mkt-pr-sh navy" />
        <span className="mkt-pr-sh sand" />
        <span className="mkt-pr-sh purple" />
        <span className="mkt-pr-sh red" />
        <div className="mkt-pr-globe-wrap">
          <div className="mkt-pr-fx">
            <span className="mkt-pr-halo" />
            <span className="mkt-pr-ring r1" />
            <span className="mkt-pr-ring r2" />
            <span className="mkt-pr-ring r3" />
            <span className="mkt-pr-spark s1" />
            <span className="mkt-pr-spark s2" />
            <span className="mkt-pr-spark s3" />
            <span className="mkt-pr-spark s4" />
            <span className="mkt-pr-spark s5" />
          </div>
          <svg className="mkt-pr-orbits" viewBox="0 0 400 400" aria-hidden="true">
            <ellipse cx="200" cy="200" rx="188" ry="72" fill="none" stroke="#e4dfd6" strokeWidth="1" strokeDasharray="3 6" transform="rotate(-22 200 200)" />
            <ellipse cx="200" cy="200" rx="176" ry="58" fill="none" stroke="#ebe6de" strokeWidth="1" strokeDasharray="2 7" transform="rotate(16 200 200)" />
            <circle cx="200" cy="200" r="152" fill="none" stroke="#ddd8cf" strokeWidth="1" strokeDasharray="2 4" />
            <ellipse cx="200" cy="200" rx="72" ry="152" fill="none" stroke="#e6e1d8" strokeWidth="0.8" strokeDasharray="2 5" />
            <ellipse cx="200" cy="200" rx="152" ry="48" fill="none" stroke="#e6e1d8" strokeWidth="0.8" strokeDasharray="2 5" />
            <ellipse cx="200" cy="200" rx="152" ry="100" fill="none" stroke="#ece7de" strokeWidth="0.7" strokeDasharray="2 6" />
            <circle cx="318" cy="118" r="3" fill="#c81322" />
            <circle cx="86" cy="168" r="3" fill="#012ea1" />
            <circle cx="274" cy="286" r="2.5" fill="#c81322" />
          </svg>
          <img className="mkt-pr-globe" src="/brand/globe.png?v=3" alt="" width="1536" height="1024" />
        </div>
      </div>

      <section className="mkt-wrap mkt-pr-hero">
        <p className="mkt-pr-kicker">
          <span className="live">● LIVE</span>
          PRICING
          <span className="sys">SYS/READY_</span>
        </p>
        <h1>
          {singleTier ? (
            <>
              The terminal is <em>free</em>
            </>
          ) : (
            <>
              Choose the plan that <em>powers</em> your mission
            </>
          )}
        </h1>
        <p className="mkt-pr-lede">
          {singleTier
            ? 'Create an account and open every desk — full coverage and AI research, at no cost.'
            : 'Niyantran Terminal delivers real-time intelligence, authoritative data, and powerful tools for government, policy, and global affairs—built for scale, security, and impact.'}
        </p>
        <div className="mkt-pr-tele">
          <span>
            <i />
            FEED 211+
          </span>
          <span>
            <i />
            BILLS 4,576
          </span>
          <span>
            <i />
            UPTIME 99.9%
          </span>
          <span className="blink">▌</span>
        </div>
      </section>

      <div className="mkt-wrap">
        {!singleTier ? (
          <div className="mkt-pr-bill">
            <span className={!yearly ? 'on' : ''}>Pay Monthly</span>
            <button
              type="button"
              className={`mkt-pr-switch${yearly ? ' on' : ''}`}
              role="switch"
              aria-checked={yearly}
              aria-label="Toggle yearly billing"
              onClick={() => setYearly((v) => !v)}
            >
              <i />
            </button>
            <span className={yearly ? 'on' : ''}>Pay Yearly</span>
            <em>Save 17%</em>
          </div>
        ) : null}

        <div className={`mkt-pr-grid${singleTier ? ' mkt-pr-grid-single' : ''}`} onMouseLeave={() => setFocus(null)}>
          {displayPlans.map((p) => {
            const price = p.custom ? 'Custom' : `$${yearly && p.yearly != null ? p.yearly : p.monthly}`;
            return (
              <article
                key={p.id}
                className={`mkt-pr-card ${p.id}${focus === p.id ? ' on' : ''}${singleTier ? ' is-row' : ''}`}
                onMouseEnter={() => setFocus(p.id)}
                onMouseMove={onCardMove}
              >
                <span className="mkt-pr-glow" aria-hidden="true" />
                {p.popular ? <div className="mkt-pr-pop">MOST POPULAR</div> : null}
                <div className="mkt-pr-card-body">
                  <div className="mkt-pr-card-lead">
                    <h2 style={{ color: p.color }}>{p.name}</h2>
                    <p className="who">{p.who}</p>
                    <div className="amt" key={`${p.id}-${price}`}>
                      {price}
                    </div>
                    <div className="unit">{p.unit}</div>
                    {!singleTier ? <p className="tag">{p.tag}</p> : null}
                    {!singleTier ? (
                      <button type="button" className={`mkt-pr-btn ${p.ctaKind}`} onClick={() => goPlan(p.id)}>
                        {p.cta}
                      </button>
                    ) : null}
                    {p.plus ? (
                      <p className="plus" style={{ color: p.color }}>
                        {p.plus}
                      </p>
                    ) : singleTier ? null : (
                      <p className="plus spacer" />
                    )}
                  </div>
                  <ul>
                    {p.items.map((item) => (
                      <li key={item}>
                        <Tick color={p.id === 'explorer' ? C.purple : p.color} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {singleTier ? (
                    <div className="mkt-pr-card-action">
                      <p className="tag">{p.tag}</p>
                      <button type="button" className={`mkt-pr-btn ${p.ctaKind}`} onClick={() => goPlan(p.id)}>
                        {p.cta}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mkt-pr-perks">
          {PERKS.map((perk) => (
            <div key={perk.title} className="mkt-pr-perk">
              <Ico d={perk.d} size={22} />
              <div>
                <h3>{perk.title}</h3>
                <p>{perk.copy}</p>
              </div>
            </div>
          ))}
        </div>

        {!singleTier ? (
          <>
            <h2 className="mkt-pr-compare-title">
              Compare Plans
              <span>hover a plan to isolate the feed</span>
            </h2>
            <div className={`mkt-pr-table-wrap${focus ? ` hi-${focus}` : ''}`}>
              <table className="mkt-pr-table">
                <thead>
                  <tr>
                    <th>FEATURES</th>
                    {PLAN_IDS.map((id, i) => (
                      <th
                        key={id}
                        className={['ex', 'pro', 'ent', 'gov'][i]}
                        onMouseEnter={() => setFocus(id)}
                        onMouseLeave={() => setFocus(null)}
                      >
                        {plans[i]?.name || ['EXPLORER', 'PROFESSIONAL', 'ENTERPRISE', 'GOVERNMENT'][i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((row) => (
                    <tr key={row[0]}>
                      <th scope="row">{row[0]}</th>
                      {row.slice(1).map((cell, i) => (
                        <td key={`${row[0]}-${i}`}>
                          <Cell value={cell} color={COL_COLOR[i]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="mkt-pr-help">
          <div className="mkt-pr-help-mark" aria-hidden="true">
            <span className="sand" />
            <span className="purple" />
          </div>
          <div className="mkt-pr-help-copy">
            <h3>{singleTier ? 'Ready to open the terminal?' : 'Not sure which plan fits your needs?'}</h3>
            <p>
              {singleTier
                ? 'Create an account and start working across every desk.'
                : 'Our team can help you find the right solution.'}
            </p>
          </div>
          <button type="button" className="mkt-pr-btn ghost-dark" onClick={() => goPlan(singleTier ? 'explorer' : 'gov')}>
            {singleTier ? 'Get started free' : 'Talk to an Expert'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
