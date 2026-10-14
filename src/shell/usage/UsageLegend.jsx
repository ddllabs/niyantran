/**
 * The "By model" legend beside the chart (F153). Hook-free. A model / provider switch, then one row per
 * series: its colour, provider mark, name, value and share. Each row is a button that shows or hides
 * its series in the chart (aria-pressed is true while it is shown).
 */
import { providerOf } from '../../lib/creditUsage.js';
import { OTHER, shareText } from '../../lib/usageChart.js';
import { Dot, ProviderMark } from './usageParts.jsx';

export default function UsageLegend({ chart, groupBy, onGroupBy, onToggle, valueText }) {
  return (
    <div className="cu-legend">
      <div className="cu-legend-head">
        <h4 className="cu-h4" id="cu-legend-title">By {groupBy}</h4>
        <div className="cu-seg-ctl cu-seg-small" role="group" aria-label="Group the chart by">
          {['model', 'provider'].map((g) => (
            <button key={g} type="button" aria-pressed={groupBy === g} className={groupBy === g ? 'on' : ''} onClick={() => onGroupBy(g)}>
              {g === 'model' ? 'Model' : 'Provider'}
            </button>
          ))}
        </div>
      </div>
      {chart && !chart.empty ? (
        <ul className="cu-legend-list" aria-labelledby="cu-legend-title">
          {chart.series.map((s) => {
            const provider = s.key === OTHER ? 'other' : groupBy === 'provider' ? s.key : providerOf(s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className={`cu-leg-row${s.hidden ? ' off' : ''}`}
                  aria-pressed={!s.hidden}
                  aria-label={`${s.label}: ${valueText(s.total)}, ${shareText(s.share)}. ${s.hidden ? 'Hidden from' : 'Shown in'} the chart`}
                  title={s.key === OTHER ? 'Every other model' : s.key}
                  onClick={() => onToggle(s.key)}
                >
                  <Dot slot={s.slot} />
                  <ProviderMark provider={provider} />
                  <span className="cu-leg-name">{s.label}</span>
                  <span className="cu-leg-val">{valueText(s.total)}</span>
                  <span className="cu-leg-share">{shareText(s.share)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cu-note">Nothing to show yet.</p>
      )}
    </div>
  );
}
