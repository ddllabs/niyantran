import { useMemo, useState } from 'react';
import { exportJson, GeoAi, GeoDossierChrome, GeoSources } from './GeoDossier.jsx';
import { commodityGroups } from '../lib/commodityGroups.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { openAiResearch } from '../lib/aiDrop.js';

const AI_SUMMARY =
  'Energy and precious metals carry a geopolitical risk premium (Middle East, Red Sea, safe-haven gold). Soft commodities (cocoa, coffee) are climate-driven. The through-line to watch: any Hormuz/Red Sea shock transmits straight into oil, freight and food-import inflation for net importers like India.';

const PROMPTS = [
  [
    'Inflation transmission',
    'Trace how the current commodity picture flows into Indian CPI and the rupee.',
  ],
  [
    'Supply shocks',
    'Which commodities are most exposed to a geopolitical supply shock in the next quarter?',
  ],
  ['Safe havens', 'Explain the gold move in the context of current geopolitical risk.'],
];

// F122: the levels are the pack's illustrative values; the Pink Sheet is offered only to check them.
const SOURCES = [['World Bank Pink Sheet (for checking)', 'https://www.worldbank.org/en/research/commodity-markets']];

function BarRow({ label, pct, val, up, on, onPick }) {
  const n = Math.max(2, Math.min(100, Number(pct) || 2));
  return (
    <button type="button" className={`geo-bar${on ? ' on' : ''}`} aria-pressed={on} data-commodity={label} onClick={onPick}>
      <span className="geo-bar-l">{label}</span>
      <span className="geo-bar-t">
        <i style={{ width: `${n}%`, background: up ? '#22c55e' : '#ef4444' }} />
      </span>
      <span className={`geo-bar-v${up ? ' up' : ' down'}`}>{val}</span>
    </button>
  );
}

/** A benchmark row opens its record (F121): clicking selects the feed row, clicking it again clears it. */
function GroupPanel({ title, items, rowFor, selected, onSelect }) {
  return (
    <section className="geo-panel">
      <div className="geo-panel-h">
        <span>{title}</span>
      </div>
      <div className="geo-panel-b">
        {items.map((it) => {
          const [name, level, change, pct] = it;
          const up = String(change || '').trim().startsWith('+');
          const row = rowFor(name);
          const on = Boolean(row && selected && (selected === row || (selected.commodity || selected.title) === name));
          return <BarRow key={name} label={name} pct={pct} val={`${level}  ${change}`} up={up} on={on} onPick={() => row && onSelect?.(on ? null : row)} />;
        })}
      </div>
    </section>
  );
}

export default function CommoditiesDesk({ feed, selected, onSelect, vizFilter, onClearViz }) {
  const [tab, setTab] = useState('analytics');
  const [q, setQ] = useState('');
  // F122: the search and the chart filter apply to the pack's groups too.
  const groups = useMemo(() => commodityGroups(feed, { q, vizFilter }), [feed, vizFilter, q]);
  const byName = useMemo(() => new Map((feed?.rows || []).map((r) => [r.commodity || r.title, r])), [feed]);
  const rowFor = (name) => byName.get(name) || null;
  const stats = feed?.meta?.stats || {};
  const asOfLabel = String(feed?.meta?.asOf || '2026-07');
  const n = stats.tracked || feed?.rows?.length || 0;

  function goAsk(prompt) {
    openAiResearch({
      prompt: typeof prompt === 'string' ? prompt : PROMPTS[0][1],
      attachFeed: true,
      row: selected || undefined,
    });
  }

  return (
    <>
      <GeoDossierChrome
        title="GLOBAL COMMODITIES"
        tag="GLOBAL COMMODITIES"
        subtitle={`AS OF ${asOfLabel.toUpperCase()} · ${n} BENCHMARKS`}
        kpis={[
          [n, 'Benchmarks', 'acc'],
          [stats.gainers ?? 0, 'Gainers', 'acc'],
          [stats.losers ?? 0, 'Losers', 'bad'],
          [groups.length || 4, 'Complexes'],
          [stats.riskPremium || '—', 'Risk premium', 'warn'],
          ['Illustrative', 'Pack levels', 'warn'],
        ]}
        tab={tab}
        onTab={(t) => {
          if (t === 'ai') {
            goAsk(PROMPTS[0][1]);
            return;
          }
          setTab(t);
        }}
        onExport={() => exportJson('commodities', { asOf: asOfLabel, stats, groups })}
        onAsk={goAsk}
        tools={
          <>
            <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
            <TableFilterPop
              feed={feed}
              q={q}
              onQ={setQ}
              searchPlaceholder="Search commodity or group"
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          </>
        }
      >
        <div className="geo-grid">
            <div>
              {groups.slice(0, 2).map((g) => (
                <GroupPanel key={g.g} title={g.g} items={g.items || []} rowFor={rowFor} selected={selected} onSelect={onSelect} />
              ))}
            </div>
            <div>
              <GeoAi summary={AI_SUMMARY} prompts={PROMPTS} onAsk={goAsk} />
              {groups.slice(2).map((g) => (
                <GroupPanel key={g.g} title={g.g} items={g.items || []} rowFor={rowFor} selected={selected} onSelect={onSelect} />
              ))}
              <GeoSources links={SOURCES} asOf={asOfLabel} note={`Levels are illustrative values in the terminal's pack, as of ${asOfLabel}; no live price feed is connected.`} />
            </div>
          </div>
      </GeoDossierChrome>
    </>
  );
}
