import { useState } from 'react';
import { PRICING_COMPARE, PRICING_NOTES, PUBLIC_PLANS, rupees } from '../lib/publicPlans.js';
import { SITE_FIGURES, figure } from '../lib/siteFigures.js';
import AuthEarth from './AuthEarth.jsx';

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
  { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.2 12.1l2.4 2.4 5.2-5.4', title: 'Secure by design', copy: 'Per-account access controls and encryption in transit' },
  { d: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5z', title: 'Source-linked records', copy: 'Official and published sources with provenance shown' },
  { d: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z', title: 'Cited AI answers', copy: 'Every answer links back to the documents it used' },
  { d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18', title: 'Eight desks', copy: 'National, state, law, global, economics, carbon, sports and entertainment' },
];

const COL_COLOR = [C.blue, C.purple, C.blue, C.red];
const TONE_COLOR = { explorer: C.blue, pro: C.purple, enterprise: C.blue, gov: C.red };

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

// Every plan starts at signup; paid plans are bought from the account once
// online payments open.
export default function PricingPage({ onLogin, onContact }) {
  const [focus, setFocus] = useState(null);
  const plans = PUBLIC_PLANS;
  const goPlan = () => onLogin?.('signup');

  return (
    <div className="mkt-pr">
      <div className="mkt-pr-art" aria-hidden="true">
        <span className="mkt-pr-scan" />
        <span className="mkt-pr-gridlines" />
        <span className="mkt-pr-sh navy" />
        <span className="mkt-pr-sh sand" />
        <span className="mkt-pr-sh purple" />
        <span className="mkt-pr-sh red" />
      </div>

      <section className="mkt-wrap mkt-pr-hero">
        <div className="mkt-pr-hero-copy">
          <p className="mkt-pr-kicker">
            <span className="live">● LIVE</span>
            PRICING
            <span className="sys">SYS/READY_</span>
          </p>
          <h1>
            Choose the plan that <em>powers</em> your mission
          </h1>
          <p className="mkt-pr-lede">
            Niyantran Terminal delivers real-time intelligence, authoritative data, and powerful tools for government, policy, and global affairs—built for scale, security, and impact.
          </p>
          <div className="mkt-pr-tele">
            <span>
              <i />
              MODULES {SITE_FIGURES.modules}
            </span>
            <span>
              <i />
              BILLS {figure(SITE_FIGURES.bills)}
            </span>
            <span>
              <i />
              DOCUMENTS {figure(SITE_FIGURES.documents)}
            </span>
            <span className="blink">▌</span>
          </div>
        </div>
        <div className="mkt-pr-earth"><AuthEarth labels={false} /></div>
      </section>

      <div className="mkt-wrap">
        <ul className="mkt-pr-facts">
          {PRICING_NOTES.map((fact) => (
            <li key={fact.title} className={`tone-${fact.tone}`}>
              <i><Ico d={fact.icon} size={15} /></i>
              <span><b>{fact.title}</b> · {fact.text}</span>
            </li>
          ))}
        </ul>

        <div className="mkt-pr-grid" onMouseLeave={() => setFocus(null)}>
          {plans.map((p) => {
            const price = rupees(p.monthly);
            return (
              <article
                key={p.id}
                className={`mkt-pr-card ${p.tone}${focus === p.tone ? ' on' : ''}`}
                onMouseEnter={() => setFocus(p.tone)}
                onMouseMove={onCardMove}
              >
                <span className="mkt-pr-glow" aria-hidden="true" />
                {p.popular ? <div className="mkt-pr-pop">MOST POPULAR</div> : null}
                <div className="mkt-pr-card-body">
                  <div className="mkt-pr-card-lead">
                    <h2 style={{ color: TONE_COLOR[p.tone] }}>{p.name}</h2>
                    <p className="who">{p.who}</p>
                    <div className="amt" key={`${p.id}-${price}`}>
                      {price}
                    </div>
                    <div className="unit">{p.unit}</div>
                    <p className="tag">{p.tag}</p>
                    <button type="button" className={`mkt-pr-btn ${p.ctaKind}`} onClick={goPlan}>
                      {p.cta}
                    </button>
                    {p.plus ? (
                      <p className="plus" style={{ color: TONE_COLOR[p.tone] }}>
                        {p.plus}
                      </p>
                    ) : (
                      <p className="plus spacer" />
                    )}
                  </div>
                  <ul>
                    {p.items.map((item) => (
                      <li key={item}>
                        <Tick color={p.tone === 'explorer' ? C.purple : TONE_COLOR[p.tone]} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
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

        <h2 className="mkt-pr-compare-title">
          Compare Plans
          <span>hover a plan to isolate the feed</span>
        </h2>
        <div className={`mkt-pr-table-wrap${focus ? ` hi-${focus}` : ''}`}>
          <table className="mkt-pr-table">
            <thead>
              <tr>
                <th>FEATURES</th>
                {plans.map((p, i) => (
                  <th
                    key={p.id}
                    className={['ex', 'pro', 'ent', 'gov'][i]}
                    onMouseEnter={() => setFocus(p.tone)}
                    onMouseLeave={() => setFocus(null)}
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRICING_COMPARE.map((row) => (
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

        <div className="mkt-pr-help">
          <div className="mkt-pr-help-mark" aria-hidden="true">
            <span className="sand" />
            <span className="purple" />
          </div>
          <div className="mkt-pr-help-copy">
            <h3>Not sure which plan fits your needs?</h3>
            <p>Write to us and we will help you choose.</p>
          </div>
          <button type="button" className="mkt-pr-btn ghost-dark" onClick={() => onContact?.()}>
            Contact us
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
