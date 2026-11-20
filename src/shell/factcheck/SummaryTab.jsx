// B3: the Summary tab. A function of the claims the panel already holds (claimSummary.js): the totals
// sentence, a compact bar and list of the five verdicts, then the Contradicted and Partly true claims, each
// with a button that opens its card in the Claims tab. No request, no model, no invented prose.
import { VERDICTS } from './factCheckText.js';
import { FILTER_KEYS } from './claimFilter.js';
import { summarizeClaims, summarySentence } from './claimSummary.js';

export function SummaryTab({ claims, ctx, onSee }) {
  const s = summarizeClaims(claims, ctx);
  if (s.total === 0) return <p className="fc-empty">{summarySentence(s)}</p>;
  return (
    <div className="fc-summary">
      <p className="fc-sum-line">{summarySentence(s)}</p>
      {s.withVerdict > 0 ? (
        <div className="fc-sum-bar" aria-hidden="true">
          {FILTER_KEYS.filter((k) => s.verdicts[k] > 0).map((k) => (
            <span key={k} className={`fc-sum-seg fc-sum-seg--${k}`} style={{ flexGrow: s.verdicts[k] }} />
          ))}
        </div>
      ) : null}
      <ul className="fc-sum-list" aria-label="Verdicts">
        {FILTER_KEYS.map((k) => (
          <li key={k} className={`fc-sum-item fc-sum-item--${k}`}>
            <span className="fc-sum-glyph" aria-hidden="true">{VERDICTS[k].glyph}</span>
            <span className="fc-sum-label">{VERDICTS[k].label}</span>
            <b className="fc-sum-count">{s.verdicts[k]}</b>
          </li>
        ))}
      </ul>
      {s.attention.length ? (
        <>
          <h4 className="fc-section">Contradicted and partly true claims</h4>
          <ul className="fc-sum-attn">
            {s.attention.map(({ claim, badge }) => (
              <li key={claim.id} className={`fc-sum-claim fc-sum-claim--${badge.key}`}>
                <span className={`fc-badge fc-badge--${badge.key}`}>
                  <span className="fc-glyph" aria-hidden="true">{badge.glyph}</span>
                  {` ${badge.label}`}
                </span>
                <span className="fc-sum-text" dir="auto">{claim.claim_en}</span>
                <button type="button" className="ltv-action-btn fc-btn" data-fc="sum-see" data-claim={claim.id} onClick={() => onSee(claim.id)}>Show card</button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
