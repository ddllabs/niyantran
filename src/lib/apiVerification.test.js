import { describe, it, expect, vi } from 'vitest';

// /api/home/latest reads nter.news articles from Supabase. With .env.local
// present the real admin client would query the live project, so this suite
// supplies a stub store instead: the test runs offline and never touches NTER.
const newsStore = vi.hoisted(() => ({
  tables: [],
  client: {
    from(table) {
      newsStore.tables.push(table);
      const query = {
        select: () => query,
        order: () => query,
        limit: () =>
          Promise.resolve({
            data: [
              {
                row: { article_id: 'stub-f29', title: 'Stub nter.news headline', url: 'https://nter.news/stub-f29', pub: '2026-09-29T00:00:00Z' },
                updated_at: '2026-09-29T00:00:00Z',
              },
            ],
            error: null,
          }),
      };
      return query;
    },
  },
}));
vi.mock('../../server/authEmailProvider.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getSupabaseAdminClient: vi.fn(() => newsStore.client),
}));

import { serveHomeSegments, serveHomeMarkets, serveHomeLatest } from '../../server/homeApi.mjs';
import { getLiveTvChannels, getLiveTvSchedule, getLiveTvArchive, getLiveTvTranscript } from '../../server/liveTvApi.mjs';
import { briefFromExtract } from '../../server/sourceExtract.mjs';
import {
  sourceUrlsForRow,
  structuralBrief,
  collectRowUrls,
  isExtractableSourceUrl,
} from './sourceDoc.js';
import {
  isPlaceholderCitation,
  isAbsoluteHttpUrl,
  applyCitationGuardToFeed,
} from './citationGuard.js';
import { DESKS, deskForFeature } from './impactRecord.js';
import fs from 'node:fs';
import path from 'node:path';

describe('CR-06 — End-to-End API Verification Suite', () => {
  describe('CR-06.1 & CR-06.2: Endpoint Inventory & Data Correctness', () => {
    it('verifies /api/home/segments contract and data correctness', async () => {
      const res = await serveHomeSegments();
      expect(res.ok).toBe(true);
      expect(typeof res.timestamp).toBe('string');
      expect(Array.isArray(res.segments)).toBe(true);
      expect(res.segments.length).toBe(8);

      for (const seg of res.segments) {
        expect(seg.id).toBeDefined();
        expect(seg.title).toBeDefined();
        expect(seg.category).toBeDefined();
        expect(seg.deskId).toBeDefined();
        expect(seg.feature).toBeDefined();
        expect(seg.liveCount).toBeGreaterThan(0);
        expect(seg.liveCountLabel).toBeDefined();
        expect(seg.status).toBeDefined();
        expect(seg.summary).toBeDefined();
        expect(Array.isArray(seg.keyMetrics)).toBe(true);
      }
    });

    it('verifies /api/livetv/* contracts and data correctness', () => {
      // 1. Channels
      const chs = getLiveTvChannels();
      expect(chs.ok).toBe(true);
      expect(Array.isArray(chs.channels)).toBe(true);
      expect(chs.channels.length).toBeGreaterThanOrEqual(8);

      // 2. Schedule
      const sch = getLiveTvSchedule('dd-news');
      expect(sch.ok).toBe(true);
      expect(sch.channelId).toBe('dd-news');
      expect(Array.isArray(sch.items)).toBe(true);

      // 3. Archive
      const arch = getLiveTvArchive();
      expect(arch.ok).toBe(true);
      expect(Array.isArray(arch.items)).toBe(true);

      // 4. Transcript
      const tr = getLiveTvTranscript('arch-dd-2026-09-26');
      expect(tr.ok).toBe(true);
      expect(tr.available).toBe(true);
      expect(Array.isArray(tr.cues)).toBe(true);
    });

    it('verifies /api/home/markets contract and data correctness', async () => {
      const res = await serveHomeMarkets();
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.rows)).toBe(true);
      // Rows must contain ticker info
      for (const row of res.rows) {
        expect(row.symbol).toBeDefined();
        expect(row.name).toBeDefined();
      }
    });

    it('verifies /api/home/latest contract (nter.news)', async () => {
      const res = await serveHomeLatest();
      expect(res.ok).toBe(true);
      expect(res.source).toBe('nter.news');
      expect(Array.isArray(res.rows)).toBe(true);
      // The rows came from the stub store, not from a live project or the seed file.
      expect(newsStore.tables).toContain('nter_news_articles');
      expect(res.rows.map((r) => r.article_id)).toEqual(['stub-f29']);
    });
  });

  describe('CR-06.3: Correct PDF & Document Source Verification', () => {
    it('correctly resolves and prioritizes real PDF/document URLs from row metadata', () => {
      const rowWithPdf = {
        bill_name: 'The Banking Laws (Amendment) Bill, 2024',
        pdf_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedLoksabha/123_2024_LS_ENG.pdf',
        source_url: 'https://sansad.in/business/bills',
      };

      const urls = collectRowUrls(rowWithPdf);
      expect(urls.toFetch).toContain(rowWithPdf.pdf_url);
      expect(isExtractableSourceUrl(rowWithPdf.pdf_url)).toBe(true);

      const resolved = sourceUrlsForRow(rowWithPdf);
      expect(resolved).toContain(rowWithPdf.pdf_url);
    });

    it('rejects placeholder or non-document registry hub URLs from source body extraction', () => {
      expect(isPlaceholderCitation('https://sansad.in/PRID=placeholder')).toBe(true);
      expect(isPlaceholderCitation('https://pib.gov.in/PressReleasePage.aspx?PRID=2056789')).toBe(false);
      expect(isAbsoluteHttpUrl('javascript:void(0)')).toBe(false);
      expect(isAbsoluteHttpUrl('https://sansad.in/bills')).toBe(true);

      // Verify citation guard strips fake placeholder rows
      const feed = {
        ok: true,
        rows: [
          { title: 'Valid row', source_url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=123' },
          { title: 'Placeholder row', source_url: 'https://sansad.in/PRID=placeholder' },
          { title: 'Javascript junk', source_url: 'javascript:alert(1)' },
        ],
      };

      const guarded = applyCitationGuardToFeed(feed);
      expect(guarded.rows.length).toBe(1);
      expect(guarded.rows[0].title).toBe('Valid row');
      expect(guarded.meta?.citationGuardDropped).toBe(2);
    });
  });

  describe('CR-06.4: Grounded Analysis Verification', () => {
    it('synthesizes structural brief strictly from verified row fields without speculative claims', () => {
      const row = {
        bill_name: 'The Energy Conservation (Amendment) Bill, 2026',
        house: 'Lok Sabha',
        current_stage: 'Pending in Committee',
        sector: 'Power & Utilities',
        date_introduced: '2026-03-15',
      };

      const brief = structuralBrief(row, { noun: 'bill' });
      expect(brief).toContain('The Energy Conservation (Amendment) Bill, 2026');
      expect(brief).toContain('House on record: Lok Sabha.');
      expect(brief).toContain('Stage / type: Pending in Committee.');
      expect(brief).toContain('Subject: Power & Utilities.');
      expect(brief).toContain('Date on record: 2026-03-15.');
      // When no downloadable PDF is linked, it must explicitly state that provenance boundary
      expect(brief).toContain('No downloadable source document is linked');
    });

    it('extracts structured brief strictly from source text without fabricating external facts', () => {
      const rawText = `THE TRIBUNALS REFORMS ACT, 2021
NO. 33 OF 2021
[13th August, 2021.]
An Act further to amend the Cinematograph Act, 1952, the Customs Act, 1962, the Trade Marks Act, 1999.
Be it enacted by Parliament in the Seventy-second Year of the Republic of India.
Section 3: Qualifications, appointment, term of office, salaries and allowances of Chairperson and Member of Tribunal.
The Chairperson and Members shall be appointed by the Central Government on the recommendation of a Search-cum-Selection Committee.`;

      const brief = briefFromExtract(rawText, { title: 'The Tribunals Reforms Act, 2021', max: 600 });
      expect(brief).toBeDefined();
      expect(brief.length).toBeGreaterThan(50);
      expect(brief).toContain('TRIBUNALS REFORMS');
      expect(brief).toContain('Search-cum-Selection');
    });
  });

  describe('CR-06.5: Sector Mapping Verification', () => {
    it('validates canonical ontology sectors and ensures non-empty taxonomy hierarchy', () => {
      const ontologyPath = path.resolve('public/data/ontology.json');
      expect(fs.existsSync(ontologyPath)).toBe(true);

      const ontology = JSON.parse(fs.readFileSync(ontologyPath, 'utf8'));
      expect(Array.isArray(ontology.sectors)).toBe(true);
      expect(ontology.sectors.length).toBeGreaterThanOrEqual(10);

      const sectorIds = new Set(ontology.sectors.map((s) => s.id));
      // Must contain core NTER sectors
      expect(sectorIds.has('power')).toBe(true);
      expect(sectorIds.has('renewables')).toBe(true);
      expect(sectorIds.has('coal')).toBe(true);
      expect(sectorIds.has('oil_gas')).toBe(true);

      for (const sector of ontology.sectors) {
        expect(sector.id).toBeDefined();
        expect(typeof sector.name).toBe('string');
        expect(Array.isArray(sector.keywords)).toBe(true);
        expect(sector.keywords.length).toBeGreaterThan(0);
      }
    });

    it('accurately maps features to analytical desk configurations in impactRecord', () => {
      expect(deskForFeature('Bill Passage Probability Index')).toBe(DESKS.bill);
      expect(deskForFeature('National Policy Pipeline')).toBe(DESKS.pipeline);
      expect(deskForFeature('Parliamentary Question Database')).toBe(DESKS.question);
      expect(deskForFeature('Regulatory Body Watch (RBI/SEBI/TRAI/CCI)')).toBe(DESKS.regulatory);
    });
  });
});
