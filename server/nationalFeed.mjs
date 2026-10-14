/**
 * National desk APIs — Niyantran_National_KPI_review_v5_2.pptx
 * Embedded registers uncapped. Live URLs as listed. Never invent rows.
 * Policy pipeline: do not extend Google News.
 */
import {
  BUDGET_KEY,
  BUDGET_SCHEMES,
  FLAGSHIP_PROGRAMMES,
  STATEMENT_LEADERS,
  UNION_PROMISES,
} from '../src/data/nationalCurated.js';
import { allocateSeats } from '../src/lib/nationalKpi.js';
import { isCabinetDecision } from '../src/lib/parliament.js';

const WB_MANF = 'https://api.worldbank.org/v2/country/IND/indicator/NV.IND.MANF.ZS?format=json&date=2000:2030&per_page=100';
const WB_IND = 'https://api.worldbank.org/v2/country/IND/indicator/NV.IND.TOTL.ZS?format=json&date=2000:2030&per_page=100';
const RBI_NOTES = 'https://www.rbi.org.in/notifications_rss.xml';
const RBI_PRESS = 'https://www.rbi.org.in/pressreleases_rss.xml';
const SEBI_RSS = 'https://www.sebi.gov.in/sebirss.xml';
/** Real person query — never search the product name "Statement & Quote Tracker…". */
/** A listed leader for the Statement Tracker (F169 T3); anything else is the first leader. */
export function statementLeader(name) {
  const want = String(name || '').trim().toLowerCase();
  return STATEMENT_LEADERS.find((p) => p.toLowerCase() === want) || STATEMENT_LEADERS[0];
}
function statementsNewsRss(person = STATEMENT_LEADERS[0]) {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(`"${person}" India when:7d`) +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}
/**
 * Use www — bare pib.gov.in often ECONNRESET from Node. ViewRss.aspx is an index, not the feed.
 * `reg=3` is required: without it PIB answers 302 to the Hindi feed (measured 2026-10-14, F169 T2).
 */
const PIB_PRESS = 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3';
const PIB_FEATURES = 'https://www.pib.gov.in/RssMain.aspx?ModId=18&Lang=1&Regid=3&reg=3';
const PIB_RSS = PIB_PRESS;
const PIB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
/** PIB often serves Hindi RSS by geo/session; English release pages need an en cookie. */
const PIB_EN_COOKIE = 'lang=1; Language=1; PIBLang=1; culture=en-US';

function decodeBasicEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHindiText(s) {
  return /[\u0900-\u097F]/.test(String(s || ''));
}

function pridOf(row) {
  const blob = `${row?.source_url || ''} ${row?.link || ''} ${row?.url || ''} ${row?.id || ''}`;
  return (String(blob).match(/PRID=(\d+)/i) || [])[1] || '';
}

async function fetchEnglishPibTitle(prid) {
  const headers = {
    'User-Agent': PIB_UA,
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: PIB_EN_COOKIE,
    Accept: 'text/html,application/xhtml+xml',
  };

  async function load(pridOrUrl) {
    const page = /^https?:/i.test(String(pridOrUrl))
      ? String(pridOrUrl).replace(/^https?:\/\/pib\.gov\.in\//i, 'https://www.pib.gov.in/')
      : `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${pridOrUrl}&Lang=1`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12_000);
    try {
      const res = await fetch(page, { signal: ac.signal, redirect: 'follow', headers });
      if (!res.ok) return null;
      const html = await res.text();
      const og = (html.match(/property="og:title"\s+content="([^"]+)"/i) || [])[1] || '';
      const h2 =
        (html.match(/<h2[^>]*>\s*([^<]{20,500})\s*<\/h2>/i) || [])[1] ||
        (html.match(/<h1[^>]*>\s*([^<]{20,500})\s*<\/h1>/i) || [])[1] ||
        '';
      const title = decodeBasicEntities(
        (og || h2)
          .replace(/\s*\|\s*Press Information Bureau.*/i, '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      // F125: the issuing body PIB names on the release page (e.g. "Cabinet Committee on Economic Affairs (CCEA)").
      const ministry = decodeBasicEntities((html.match(/<div[^>]*MinistryName[^>]*>\s*([^<]+)</i) || [])[1] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const dateHint = (html.match(/Posted On:\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/i) || [])[1] || '';
      let date = '';
      if (dateHint) {
        // Read as UTC: a bare "14 Oct 2026" in local time is the 13th in India once made ISO.
        const d = new Date(`${dateHint} UTC`);
        if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
      // Hindi release pages expose an "English" sibling with a different PRID.
      const enHref =
        (html.match(/href=['"]([^'"]*PRID=\d+[^'"]*)['"][^>]*>\s*English(?:\s+Version)?\s*</i) || [])[1] ||
        (html.match(/href=['"]([^'"]*PRID=\d+[^'"]*Lang=1[^'"]*)['"]/i) || [])[1] ||
        (html.match(/href=['"]([^'"]*PressReleasePage\.aspx\?PRID=\d+[^'"]*)['"][^>]*>[^<]{0,40}English/i) || [])[1] ||
        '';
      const enPrid = (String(enHref).match(/PRID=(\d+)/i) || [])[1] || '';
      // Sometimes English is only in an embedded tweet / quote block.
      const tweetEn =
        (html.match(/<blockquote[^>]*>[\s\S]*?<p[^>]*>\s*([A-Za-z][^<]{40,280})\s*</i) || [])[1] ||
        (html.match(/>([A-Z][A-Za-z0-9 ,.'’\-()]{40,220}(?:crore|minister|cabinet|approves|launches|presents)[^<]{0,80})</i) ||
          [])[1] ||
        '';
      return {
        title,
        date,
        ministry,
        source_url: page,
        hindi: isHindiText(title),
        enPrid,
        tweetEn: decodeBasicEntities(tweetEn).replace(/\s+/g, ' ').trim(),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  const first = await load(prid);
  if (!first) return null;
  if (!first.hindi && first.title) {
    return { title: first.title, date: first.date, source_url: first.source_url, ministry: first.ministry };
  }
  if (first.enPrid && String(first.enPrid) !== String(prid)) {
    const en = await load(first.enPrid);
    if (en && !en.hindi && en.title) {
      // The English page names the body in English; the Hindi page's name is the fallback.
      return { title: en.title, date: en.date || first.date, source_url: en.source_url, ministry: en.ministry || first.ministry };
    }
  }
  if (first.tweetEn && !isHindiText(first.tweetEn) && first.tweetEn.length > 24) {
    return { title: first.tweetEn, date: first.date, source_url: first.source_url, ministry: first.ministry };
  }
  return null;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** RSS is often Hindi; resolve English titles from PressReleasePage with en cookie. */
/**
 * PIB rows with English titles. With { ministry: true } (F125) every row's release page is read for
 * its issuing body, including rows whose RSS title is already English.
 */
async function enrichPibEnglish(rows, opts = {}) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, 40);
  const enriched = await mapPool(list, 8, async (row, idx) => {
    const base = {
      ...row,
      id: row.id != null ? row.id : `pib-${idx}`,
      stage: row.stage || 'PIB release',
      source: row.source || 'Press Information Bureau',
    };
    const title = String(base.title || base.topic || base.headline || '');
    const prid = pridOf(base);
    if (!prid) {
      return {
        ...base,
        title,
        topic: base.topic || title,
      };
    }
    if (!isHindiText(title) && title) {
      const url = base.source_url || `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${prid}&Lang=1`;
      // PIB's English RSS has no dates (checked 2026-10-14), so the release page gives the date,
      // and the issuing body when asked for (F125).
      const page = opts.ministry || !base.date ? await fetchEnglishPibTitle(prid) : null;
      return {
        ...base,
        title,
        topic: base.topic || title,
        source_url: url,
        language: 'en',
        ...(page?.date && !base.date ? { date: page.date } : {}),
        ...(opts.ministry && page?.ministry ? { ministry: page.ministry } : {}),
      };
    }
    const en = await fetchEnglishPibTitle(prid);
    if (!en) {
      return { ...base, title, topic: base.topic || title };
    }
    return {
      ...base,
      title: en.title,
      topic: en.title,
      date: en.date || base.date || '',
      source_url: en.source_url,
      language: 'en',
      ...(en.ministry ? { ministry: en.ministry } : {}),
    };
  });
  const english = enriched.filter((r) => {
    const t = r?.title || r?.topic || '';
    return t && !isHindiText(t);
  });
  return english.length ? english : [];
}

function featName(feat) {
  return String(feat?.htmlFeature || '');
}
function heading(feat) {
  return String(feat?.workbookFunctions || feat?.htmlFeature || '').toUpperCase();
}

export async function serveNational(ctx) {
  const { feat, dataset, primary, links, coverage, loadEmbedded, tryUrls, envelope, statusRow } = ctx;
  const name = featName(feat);
  const tier = 'national';
  const archive =
    loadEmbedded(dataset) ||
    (/policy intelligence graph/i.test(name) ? loadEmbedded('national_bill_tracker.csv') : null) ||
    (/mp profiles/i.test(name) ? loadEmbedded('national_mp_report_card.csv') : null);

  if (/^bill passage/i.test(name)) {
    const rows = archive || [];
    if (!rows.length) return null;
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://sansad.in/api_rs/legislation/getBills?page=1&size=100&sortOn=billIntroducedDate&sortBy=desc'],
      coverage: { from: '1952-01-01', through: 'present', exhaustive: true },
      fallback: false,
      note: 'national_bill_tracker.csv — 1952–present. Sansad getBills is not wired for refresh. current_stage only; no passing date, so passed-per-year is not drawn. probability_score is a stored column, not a simulator.',
      meta: { section: 'BILL PASSAGE INDEX', status: 'REGISTER · SANSAD / PRS ARCHIVE', heading: heading(feat) },
    });
  }

  if (/policy intelligence graph/i.test(name)) {
    const rows = archive || [];
    if (!rows.length) return null;
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://sansad.in/api_rs/legislation/getBills?page=1&size=100&sortOn=billIntroducedDate&sortBy=desc'],
      coverage: { from: '1952-01-01', through: 'present', exhaustive: true },
      fallback: false,
      kind: 'graph',
      note: 'Sansad getBills is not wired for refresh. Register holds current_stage only — passed counts are stage labels, not passing dates.',
      meta: { section: 'POLICY INTELLIGENCE GRAPH', status: 'REGISTER · SANSAD / PRS ARCHIVE', heading: heading(feat) },
    });
  }

  if (/policy pipeline/i.test(name)) {
    const live = await tryUrls([PIB_PRESS, PIB_FEATURES]);
    const liveRows = await enrichPibEnglish(live.rows || []);
    if (liveRows.length) {
      const enCount = liveRows.filter((r) => !isHindiText(r.title)).length;
      return envelope({
        tier,
        feature: feat,
        rows: liveRows,
        adapter: 'api',
        links: [PIB_PRESS, PIB_FEATURES, 'https://www.pib.gov.in/ViewRss.aspx?reg=3&lang=1'],
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note:
          enCount === liveRows.length
            ? 'Live PIB RSS with English titles resolved from PressReleasePage (EN cookie). Draft-to-gazette stages are not in the RSS.'
            : `Live PIB RSS — ${enCount}/${liveRows.length} English titles resolved; remainder still Hindi from the feed locale.`,
        meta: {
          section: 'POLICY PIPELINE — DRAFT TO GAZETTE',
          status: 'LIVE · PIB RSS · EN',
          heading: heading(feat),
        },
      });
    }
    const rows = (archive || []).map((r, i) => ({ ...r, id: r.id != null ? r.id : String(i) }));
    if (!rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: PIB_PRESS,
          reason: live.error || 'PIB RSS empty',
          featureName: name,
        }),
        adapter: 'api',
        links: [PIB_PRESS, 'https://www.pib.gov.in/ViewRss.aspx?reg=3&lang=1'],
        coverage,
        fallback: false,
        note: 'PIB Press Releases RSS did not return rows and no archive is available.',
        meta: { section: 'POLICY PIPELINE — DRAFT TO GAZETTE', status: 'OFFLINE', heading: heading(feat) },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: [PIB_PRESS, 'https://egazette.gov.in/'],
      coverage,
      fallback: true,
      note: `PIB RSS unavailable (${live.error || 'empty'}). Showing the ${rows.length}-row last-known-good register. news.google.com is not used.`,
      meta: {
        section: 'POLICY PIPELINE — DRAFT TO GAZETTE',
        status: 'ARCHIVE · LAST-KNOWN-GOOD',
        heading: heading(feat),
      },
    });
  }

  if (/parliamentary question/i.test(name)) {
    const rows = archive || [];
    if (!rows.length) return null;
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://elibrary.sansad.in/'],
      coverage,
      fallback: false,
      note: 'Answer text is absent from every row. elibrary.sansad.in DSpace is not wired. Sub-label is honest about a loaded sample.',
      meta: { section: 'PARLIAMENTARY QUESTIONS', status: 'ARCHIVE · LARGEST NATIONAL DATASET', heading: heading(feat) },
    });
  }

  if (/regulatory body watch/i.test(name)) {
    // F169 T6: the three feeds together (it used to stop at the first that answered), then the
    // stored register behind them; one row per link, newest first.
    const feeds = [
      [RBI_NOTES, 'RBI'],
      [RBI_PRESS, 'RBI'],
      [SEBI_RSS, 'SEBI'],
    ];
    const answers = await Promise.all(feeds.map(([url]) => tryUrls([url])));
    const liveRows = answers.flatMap((a, k) => (a.rows || []).map((r) => ({ ...r, regulator: r.regulator || feeds[k][1] })));
    const seen = new Set();
    const keyOf = (r) => String(r.source_url || r.detail_url || r.link || r.title || '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
    const rows = [...liveRows, ...(archive || [])]
      .filter((r) => {
        const key = keyOf(r);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    if (!rows.length) return null;
    const answered = feeds.filter((_, k) => answers[k].rows?.length).map(([url]) => url);
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: liveRows.length ? 'live' : 'embedded',
      links: [RBI_NOTES, RBI_PRESS, SEBI_RSS],
      coverage,
      fallback: !liveRows.length,
      note: liveRows.length
        ? `RBI notifications, RBI press releases and SEBI (${liveRows.length} live items from ${answered.length} of 3 feeds), with the stored register behind them. TRAI, CBDT, IBBI and CCI are not connected.`
        : 'The regulator feeds did not answer. Showing the stored register.',
      meta: {
        section: 'REGULATORY WATCH — RBI / SEBI / TRAI / CCI',
        status: liveRows.length ? 'LIVE · REGULATOR RSS' : 'ARCHIVE · LAST-KNOWN-GOOD',
        heading: heading(feat),
      },
    });
  }

  if (/candidate affidavit/i.test(name) && archive?.length) {
    return envelope({
      tier,
      feature: feat,
      rows: archive,
      adapter: 'embedded',
      links: ['https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/26863'],
      coverage,
      fallback: false,
      note: 'MyNeta / ADR basis already shipped. ADR terms bar commercial use, resale, redistribution and scraping. ECI + kaarana/AffidavitManagement is the compliant re-source and is not wired. No crimometer score.',
      meta: { section: 'CANDIDATE AFFIDAVITS', status: 'REGISTER · LICENCE-BLOCKED TO EXTEND', heading: heading(feat) },
    });
  }

  if (/delimitation/i.test(name)) {
    const rows = allocateSeats(753);
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'internal',
      links: links || [],
      coverage: { from: '2011', through: '2036', exhaustive: false },
      fallback: false,
      kind: 'simulator',
      note: 'SIMULATION · LARGEST REMAINDER · NCP 2011–36 PROJECTIONS · ILLUSTRATIVE. Analytics consume this output so the pane is not “unwired”.',
      meta: {
        section: 'SEAT REALLOCATION SIMULATOR',
        status: 'SIMULATION · LARGEST REMAINDER · NCP 2011–36 · ILLUSTRATIVE',
        heading: heading(feat),
        kind: 'simulator',
      },
    });
  }

  if (/manifestos/i.test(name)) {
    const rows = UNION_PROMISES.map(([promise, domain, verifiable_status]) => ({
      promise,
      domain,
      verifiable_status,
      title: promise,
      cycle: '2024',
    }));
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://www.bjp.org/manifesto', 'https://manifesto.inc.in/'],
      coverage: { from: '2024', through: '2024', exhaustive: false },
      fallback: false,
      note: 'CURATED · AS OF JAN 2026 · VERIFY AGAINST GAZETTE / PIB. Verifiable status, not fulfilled/broken. Sarkari Vaade 346-commitment package is not ingested (licence unresolved).',
      meta: { section: 'UNION MANIFESTO TRACKER — 2024', status: 'CURATED · VERIFY AGAINST GAZETTE / PIB', heading: heading(feat) },
    });
  }

  if (/mp profiles/i.test(name)) {
    const rows = archive || [];
    if (!rows.length) return null;
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://sansad.in/api_ls/member?page=1&size=100'],
      coverage,
      fallback: false,
      kind: 'cards',
      note: 'national_mp_report_card.csv — current house. Attendance empty in every row. Committees filled on most rows; blanks read “not recorded”, never “none”.',
      meta: { section: 'MP REPORT CARDS', status: 'REGISTER · LOK SABHA AND RAJYA SABHA', heading: heading(feat) },
    });
  }

  if (/statement/i.test(name)) {
    // F169 T3: the leader the page asked for; Google News only (GDELT refuses every request, T4).
    const person = statementLeader(ctx.person);
    const newsUrl = statementsNewsRss(person);
    const rss = await tryUrls([newsUrl]);
    if (rss.rows?.length) {
      return envelope({
        tier,
        feature: feat,
        rows: rss.rows.map((r) => ({ ...r, person })),
        adapter: 'news-search',
        links: [newsUrl],
        coverage: { from: '', through: '7d', exhaustive: false },
        fallback: false,
        gdelt: false,
        kind: 'wire',
        note: `Google News coverage of "${person}" from the last 7 days. Media mentions, not a statement archive; no contradiction verdict.`,
        meta: {
          section: 'MEDIA MENTIONS',
          status: 'LIVE · NEWS SEARCH',
          heading: heading(feat),
          person,
        },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'news-search',
        url: newsUrl,
        reason: rss.error || 'empty coverage wire',
        featureName: name,
      }),
      adapter: 'news-search',
      links: [newsUrl],
      coverage: { through: '7d' },
      fallback: false,
      gdelt: false,
      kind: 'wire',
      note: `No coverage of "${person}" came back from the news search. No contradiction verdict is invented.`,
      meta: { section: 'MEDIA MENTIONS', status: 'OFFLINE', heading: heading(feat), person },
    });
  }

  if (/morning brief/i.test(name)) {
    // F169 T3: PIB and two Google News searches together; GDELT is not asked (it refuses every
    // request, T4).
    const topNews =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent('India government OR parliament when:3d') +
      '&hl=en-IN&gl=IN&ceid=IN:en';
    const ecoNews =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent('India (RBI OR economy OR markets OR rupee) when:3d') +
      '&hl=en-IN&gl=IN&ceid=IN:en';

    const [pibLive, topLive, ecoLive] = await Promise.all([tryUrls([PIB_PRESS]), tryUrls([topNews]), tryUrls([ecoNews])]);
    const pibRows = await enrichPibEnglish(pibLive.rows || []);
    const topRows = topLive.rows || [];
    const ecoRows = ecoLive.rows || [];

    const tagged = [
      ...topRows.map((r) => ({ ...r, section: 'Top of the Day', source: r.publisher || r.source || 'News' })),
      ...pibRows.map((r) => ({ ...r, section: 'Government Wire', source: r.source || 'PIB' })),
      ...ecoRows.map((r) => ({ ...r, section: 'Economy', source: r.publisher || r.source || 'News' })),
    ];
    if (tagged.length) {
      return envelope({
        tier,
        feature: feat,
        rows: tagged,
        adapter: 'news-search',
        links: [PIB_PRESS, topNews, ecoNews],
        coverage: { from: '', through: '3d', exhaustive: false },
        fallback: false,
        gdelt: false,
        kind: 'panel',
        note: `Morning Brief: top stories ${topRows.length}, PIB ${pibRows.length}, economy ${ecoRows.length}. Not a personalised digest.`,
        meta: {
          section: 'MORNING BRIEF',
          status: 'LIVE · PIB + WIRES',
          heading: heading(feat),
          items: tagged.length,
          pib: String(pibRows.length),
        },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'news-search',
        url: topNews,
        reason: [pibLive.error, topLive.error, ecoLive.error].filter(Boolean).join(' | ') || 'all wires empty',
        featureName: name,
      }),
      adapter: 'news-search',
      links: [PIB_PRESS, topNews, ecoNews],
      coverage: { through: '3d' },
      fallback: false,
      gdelt: false,
      kind: 'panel',
      note: 'Morning Brief sources returned no rows (PIB and news search unreachable). No digest was invented.',
      meta: { section: 'MORNING BRIEF', status: 'OFFLINE', heading: heading(feat) },
    });
  }

  if (/central tender/i.test(name) && archive?.length) {
    return envelope({
      tier,
      feature: feat,
      rows: archive,
      adapter: 'embedded',
      links: ['https://eprocure.gov.in/epublish/app?page=FrontEndTendersByOrganisation&service=page'],
      coverage,
      fallback: true,
      note: 'eProcure is HTML-gated. value_inr, sector, ministry_department and location are empty in all rows — Total Value must not print ₹0. GeM BidPlus robots.txt bars automated retrieval.',
      meta: { section: 'CENTRAL TENDERS', status: 'ARCHIVE · EPROCURE LAST-KNOWN-GOOD', heading: heading(feat) },
    });
  }

  if (/bureaucratic transfers|agmut/i.test(name) && archive?.length) {
    return envelope({
      tier,
      feature: feat,
      rows: archive,
      adapter: 'embedded',
      links: ['https://mha.gov.in/', 'https://services.delhi.gov.in/orders/378'],
      coverage,
      fallback: false,
      note: 'AGMUT cadre transfer register as gazetted. services.delhi.gov.in/orders/378 is not wired. Awards are not a field.',
      meta: { section: 'IAS / IPS TRANSFERS (AGMUT)', status: 'REGISTER · GAZETTED ORDERS', heading: heading(feat) },
    });
  }

  if (/cabinet decisions/i.test(name)) {
    const live = await tryUrls([PIB_RSS, primary].filter(Boolean));
    // F125: releases whose issuing body, as PIB's own release page names it, is the Cabinet or one
    // of its committees; plus, by the owner's rule of 2026-10-14, PIB releases titled "Cabinet
    // approves…" or "Cabinet apprises…" that PIB files under a ministry.
    const liveEn = await enrichPibEnglish(live.rows || [], { ministry: true });
    const shaped = (rows) =>
      (rows || []).map((r, i) => ({
        ...r,
        id: r.id != null ? r.id : `cabinet-${i}`,
        topic: r.topic || r.title || '',
        title: r.title || r.topic || '',
        ministry: r.ministry || '',
      }));
    const archiveRows = shaped(archive || []).filter(isCabinetDecision);
    const liveRows = shaped(liveEn).filter(isCabinetDecision);
    const rows = liveRows.length ? liveRows : archiveRows;
    if (!rows.length) return null;
    const checked = liveEn.length;
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: liveRows.length ? 'live' : 'embedded',
      links: [PIB_RSS],
      coverage,
      fallback: !liveRows.length,
      note: liveRows.length
        ? `PIB RSS filtered to Cabinet decisions (${liveRows.length} of ${checked} latest releases).`
        : checked
          ? `No Cabinet decision in the latest PIB window (${checked} releases checked). Showing the stored Cabinet decisions.`
          : 'PIB RSS returned no readable releases. Showing the stored Cabinet decisions.',
      meta: {
        section: 'CABINET DECISIONS',
        status: liveRows.length ? 'LIVE · PIB RSS · EN' : 'STORED · LAST-KNOWN-GOOD',
        heading: heading(feat),
      },
    });
  }

  if (/centre-sanctioned|central projects/i.test(name)) {
    const rows = FLAGSHIP_PROGRAMMES.map(([programme, domain, verifiable_status, activity]) => ({
      programme,
      domain,
      verifiable_status,
      activity,
      title: programme,
    }));
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://ipm.mospi.gov.in/'],
      coverage: { from: '2026-01', through: '2026-01', exhaustive: false },
      fallback: false,
      note: 'Eight flagship programmes. PAIMANA not wired — no original/revised cost, expenditure or end dates. Winning bidder is dropped (refuted).',
      meta: { section: 'FLAGSHIP PROGRAMMES', status: 'CURATED · AS OF JAN 2026', heading: heading(feat) },
    });
  }

  if (/industry updates/i.test(name)) {
    const live = await tryUrls([WB_MANF, WB_IND, primary].filter(Boolean));
    if (live.rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows: live.rows,
        adapter: 'live',
        links: [WB_MANF, WB_IND],
        coverage,
        fallback: false,
        note: 'World Bank NV.IND.MANF.ZS / NV.IND.TOTL.ZS — India, % of GDP. Units and issuing authority on the chart. Fiscal deficit, forex, IIP, WPI are not wired.',
        meta: { section: 'INDUSTRY UPDATES — WORLD BANK', status: 'LIVE · WORLD BANK WDI', heading: heading(feat) },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: WB_MANF,
        reason: 'World Bank open-data API unreachable from this network — it will retry automatically.',
        featureName: name,
      }),
      adapter: 'api',
      links: [WB_MANF],
      coverage,
      fallback: false,
      note: 'World Bank open-data API unreachable from this network — it will retry automatically.',
    });
  }

  if (/budget utilisation|budget & schemes/i.test(name)) {
    const rows = [
      ...BUDGET_KEY.map(([measure, value, note]) => ({ title: measure, value, note, kind: 'headline' })),
      ...BUDGET_SCHEMES.map(([scheme, allocation_cr]) => ({
        title: scheme,
        scheme,
        allocation_cr,
        kind: 'scheme',
      })),
    ];
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: 'embedded',
      links: ['https://www.indiabudget.gov.in/'],
      coverage: { from: '2025', through: '2026', exhaustive: false },
      fallback: false,
      note: 'CURATED · VERIFY AGAINST INDIABUDGET.GOV.IN. PDF is authoritative if Excel disagrees. Allocation only — scheme-level utilisation is refuted.',
      meta: { section: 'UNION BUDGET 2025–26', status: 'CURATED · APPROXIMATE', heading: heading(feat) },
    });
  }

  return null;
}
