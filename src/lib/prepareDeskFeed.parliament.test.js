import { describe, expect, it } from 'vitest';
import register from '../../public/data/embedded_csv/national_mp_report_card.json';
import { prepareDeskFeed } from './prepareDeskFeed.js';

// F126: every MP feed the desk paints, live or stored, carries the house and the unified party.
describe('prepareDeskFeed and the MP register', () => {
  it('adds the house and the unified party to the MP register, keeping the original party', () => {
    const feed = prepareDeskFeed({ feature: 'MP Profiles & Performance (MPLAD, attendance, debates)', tier: 'national', rows: register.slice(0, 600) });
    const rs = feed.rows.find((r) => r.party_raw === 'Bharatiya Janata Party');
    expect(rs).toMatchObject({ house: 'Rajya Sabha', party: 'BJP' });
    expect(feed.rows.every((r) => r.house === 'Lok Sabha' || r.house === 'Rajya Sabha')).toBe(true);
  });

  it('leaves other modules\' rows alone', () => {
    const rows = [{ title: 'x', party: 'Bharatiya Janata Party', source_url: 'https://sansad.in/rs/x' }];
    const feed = prepareDeskFeed({ feature: 'Candidate Affidavit Database (Structured + API)', tier: 'national', rows });
    expect(feed.rows[0]).not.toHaveProperty('house');
    expect(feed.rows[0].party).toBe('Bharatiya Janata Party');
  });
});
