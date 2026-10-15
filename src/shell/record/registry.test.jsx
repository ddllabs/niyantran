import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import warTracker from '../../../public/data/embedded_csv/geopolitics_war_tracker.json';
import alliancesPack from '../../data/alliances.json';
import { flattenAlliance } from '../../lib/alliances.js';
import bills from '../../../public/data/embedded_csv/national_bill_tracker.json';
import { adapterFor } from './registry.js';

vi.mock('../RecordDetail.jsx', () => ({ default: () => <div data-record-detail /> }));
vi.mock('../../desks/NationalRecord.jsx', () => ({ default: () => <div data-national-record /> }));
const { default: RailContent } = await import('../RailContent.jsx');

// F121: only registered Global modules switch to the record panel; every other desk keeps the
// existing record view, so nothing outside the batch changes.
describe('record panel registry', () => {
  it('registers the Global modules of batches 1–3 and nothing else', () => {
    for (const feature of ['Open Fronts', 'Global Intelligence', 'Infra', 'Satellite Infrastructure', 'Global Commodities', 'Growth Indicators', 'Global Trade', 'World Constitutions', 'Heads of State', 'Geopolitics News Wire', 'Alliances', 'Sanctions', 'Global Aid', 'Nuclear Watch', 'Bill Passage Probability Index', 'Policy Pipeline Tracker (Draft-to-Gazette)', 'Parliamentary Question Database', 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)', 'MP Profiles & Performance (MPLAD, attendance, debates)']) expect(adapterFor(feature), feature).toBeTypeOf('function');
    for (const feature of ['Maritime Choke-Points', 'Energy', 'Central Tender Aggregator + Constituency Filter', '', undefined]) expect(adapterFor(feature), String(feature)).toBeNull();
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

  it('gives every record panel the AI brief box, starting while the brief is fetched or written', () => {
    const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Open Fronts', tier: 'global', rows: warTracker }} selected={warTracker[0]} />);
    expect(html).toContain('✦ Niyantran analysis');
    expect(html).toContain('Writing AI brief…');
  });

  it('keeps the existing National record view for National modules the reference does not cover', () => {
    for (const feature of ['Central Tender Aggregator + Constituency Filter', 'Bureaucratic Transfers — AGMUT Cadre', 'Budget Utilisation & Schemes']) {
      const row = { title: 'A row', id: '1' };
      const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature, tier: 'national', rows: [row] }} selected={row} />);
      expect(html, feature).toContain('data-national-record');
      expect(html, feature).not.toContain('class="rp"');
    }
  });

  it('renders the record panel, not the old National view, for a registered National module', () => {
    const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Bill Passage Probability Index', tier: 'national', rows: bills.slice(0, 50) }} selected={bills[0]} />);
    expect(html).toContain('class="rp"');
    expect(html).not.toContain('data-national-record');
  });

  it('scopes Cabinet Decisions to the National desk, leaving the State desk module of the same name alone', () => {
    expect(adapterFor('Cabinet Decisions', 'national')).toBeTypeOf('function');
    expect(adapterFor('Cabinet Decisions', 'state')).toBeNull();
    expect(adapterFor('Cabinet Decisions')).toBeNull();
    expect(adapterFor('Candidate Affidavit Database (Structured + API)', 'national')).toBeTypeOf('function');
    expect(adapterFor('Candidate Affidavit Database (Structured + API)', 'state')).toBeNull();
    expect(adapterFor('National Morning Brief (Auto-digest)', 'national')).toBeTypeOf('function');
    const row = { title: 'Cabinet approves the scheme', date: '2026-10-01' };
    const state = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Cabinet Decisions', tier: 'state', rows: [row] }} selected={row} />);
    expect(state).not.toContain('class="rp"');
    const national = renderToStaticMarkup(<RailContent view="record" feed={{ feature: 'Cabinet Decisions', tier: 'national', rows: [row] }} selected={row} />);
    expect(national).toContain('class="rp"');
  });
});

// F128: every Law module in the catalogue renders the record panel, on the judiciary tier only, and
// selecting a Law record no longer reaches RecordDetail (which generated a brief on selection).
describe('record panel registry: Law', () => {
  it('registers all twelve Law modules on the judiciary tier and nowhere else', async () => {
    const { modulesForTier } = await import('../../desks/catalog.js');
    const law = modulesForTier('judiciary').map((m) => m.htmlFeature || m.name || m);
    expect(law).toHaveLength(12);
    for (const feature of law) {
      expect(adapterFor(feature, 'judiciary'), feature).toBeTypeOf('function');
      expect(adapterFor(feature, 'national'), feature).toBeNull();
      expect(adapterFor(feature), feature).toBeNull();
    }
    for (const feature of ['Supreme Courts & Precedent — United States', 'Constitutional Bench Tracker']) expect(adapterFor(feature, 'judiciary'), feature).toBeNull();
  });

  it('renders the panel, not RecordDetail, for a selected Law record', () => {
    const cases = [
      ['NCLT / NCLAT (Insolvency)', { title: 'ACME PRIVATE LIMITED', entity: 'ACME PRIVATE LIMITED', court: 'IBBI', process_type: 'Public Announcement of Corporate Insolvency Resolution Process', date: '2026-08-08', last_submission_date: '2026-08-22', source_url: 'https://ibbi.gov.in/a.pdf' }],
      ['Supreme Court Order & Judgment Feed', { case_title: 'A VS. B', title: 'A VS. B', diary_no: '1 / 2026', date: '03-Jul-2026', topic: 'Bail / Criminal', court: 'Supreme Court' }],
      ['ICC Proceedings', { title: 'Court hears plea - LiveLaw', publisher: 'LiveLaw', date: 'Mon, 12 Oct 2026 09:00:00 GMT', source_url: 'https://news.google.com/rss/articles/x', section: 'COVERAGE — GOOGLE NEWS RSS' }],
    ];
    for (const [feature, row] of cases) {
      const html = renderToStaticMarkup(<RailContent view="record" feed={{ feature, tier: 'judiciary', rows: [row] }} selected={row} />);
      expect(html, feature).toContain('class="rp"');
      expect(html, feature).not.toContain('data-record-detail');
      expect(html, feature).toContain('rp-tile rp-clock');
    }
  });
});
