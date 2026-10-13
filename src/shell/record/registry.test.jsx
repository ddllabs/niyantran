import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import warTracker from '../../../public/data/embedded_csv/geopolitics_war_tracker.json';
import alliancesPack from '../../data/alliances.json';
import { flattenAlliance } from '../../lib/alliances.js';
import { adapterFor } from './registry.js';

vi.mock('../RecordDetail.jsx', () => ({ default: () => <div data-record-detail /> }));
const { default: RailContent } = await import('../RailContent.jsx');

// F121: only registered Global modules switch to the record panel; every other desk keeps the
// existing record view, so nothing outside the batch changes.
describe('record panel registry', () => {
  it('registers the Global modules of batches 1–3 and nothing else', () => {
    for (const feature of ['Open Fronts', 'Global Intelligence', 'Infra', 'Satellite Infrastructure', 'Global Commodities', 'Growth Indicators', 'Global Trade', 'World Constitutions', 'Heads of State', 'Geopolitics News Wire', 'Alliances', 'Sanctions', 'Global Aid', 'Nuclear Watch']) expect(adapterFor(feature), feature).toBeTypeOf('function');
    for (const feature of ['Bill Passage Probability Index', 'Maritime Choke-Points', 'Energy', '', undefined]) expect(adapterFor(feature), String(feature)).toBeNull();
  });

  it('renders the panel for a registered module and the old view for others', () => {
    const row = warTracker[0];
    const panel = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Open Fronts', tier: 'global', rows: warTracker }} selected={row} />);
    expect(panel).toContain('class="rp"');
    expect(panel).not.toContain('data-record-detail');
    const other = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Maritime Choke-Points', tier: 'global', rows: [{ title: 'Strait of Hormuz' }] }} selected={{ title: 'Strait of Hormuz' }} />);
    expect(other).toContain('data-record-detail');
    expect(other).not.toContain('class="rp"');
  });

  it('keeps the old view for a source-status row on a registered module', () => {
    const status = { title: 'Source offline or empty', status: 'source_status', detail: 'No records were invented.' };
    const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Open Fronts', tier: 'global', rows: [status] }} selected={status} />);
    expect(html).toContain('data-record-detail');
    expect(html).not.toContain('class="rp"');
  });

  it('renders the record panel, not the retired dossier view, for the four dossier modules', () => {
    const rows = (alliancesPack.alliances || alliancesPack).map(flattenAlliance);
    const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Alliances', tier: 'global', rows, meta: {} }} selected={rows[0]} />);
    expect(html).toContain('class="rp"');
    expect(html).not.toMatch(/class="alw-/);
  });

  it('gives every record panel the saved-AI-brief box, starting with the lookup', () => {
    const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Open Fronts', tier: 'global', rows: warTracker }} selected={warTracker[0]} />);
    expect(html).toContain('✦ Niyantran analysis');
    expect(html).toContain('Checking for a saved AI brief');
  });
});
