/**
 * Build public/data/nter-news.json from the 51 published article URLs.
 * Run: node tools/seed_nter_news.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LINKS = path.join(ROOT, '..', '..', '..', '..', 'Users', 'hp', 'Downloads', 'NTER_News_51_Article_Links.txt');
const FALLBACK_LINKS = [
  'https://nter.news/articles/the-donation-box-has-reached-the-courtroom/',
  'https://nter.news/articles/the-world-is-building-a-new-table-without-the-superpowers/',
  'https://nter.news/articles/europe-is-preparing-for-a-war-it-hopes-never-comes/',
  'https://nter.news/articles/south-korea-is-demilitarised-in-name-only/',
  'https://nter.news/articles/india-s-medal-story-is-already-splitting-into-two/',
  'https://nter.news/articles/germany-is-not-moving-right-it-is-fragmenting/',
  'https://nter.news/articles/the-strait-the-machine-and-the-missile/',
  'https://nter.news/articles/who-gets-to-laugh-at-power/',
  'https://nter.news/articles/the-rebellion-he-left-behind/',
  'https://nter.news/articles/who-owns-the-working-week/',
  'https://nter.news/articles/the-6-october-by-polls-the-nomination-drama/',
  'https://nter.news/articles/the-sugar-trail-what-parliament-saw-before-fssai-acted/',
  'https://nter.news/articles/when-the-referee-decides-the-jersey/',
  'https://nter.news/articles/you-are-not-serious-people-inside-tata-sons-succession-fight/',
  'https://nter.news/articles/from-howdy-modi-to-100-tariffs/',
  'https://nter.news/articles/semicon-2-0-india-s-second-bet-on-the-chip-economy/',
  'https://nter.news/articles/the-mukuhlani-precedent-a-historic-appointment-with-a-complicated-history/',
  'https://nter.news/articles/from-atmanirbhar-to-viksit-bharat-the-price-of-free-upi/',
  'https://nter.news/articles/when-india-and-pakistan-collide-at-sea-the-real-test-is-what-happens-next/',
  'https://nter.news/articles/the-200-arrests-were-the-headline-the-network-is-the-story/',
  'https://nter.news/articles/india-new-zealand-fta-what-the-deal-really-changes-for-india/',
  'https://nter.news/articles/india-s-employment-numbers-are-supposedly-improving-but-are-jobs-really-getting-better/',
  'https://nter.news/articles/when-mecca-went-on-air-raid-alert/',
  'https://nter.news/articles/the-day-the-united-states-admitted-it-has-weapons-in-orbit/',
  'https://nter.news/articles/rajasthan-s-urban-verdict-the-bjp-leads-but-the-map-is-far-more-fragmented-than-the-headline/',
  'https://nter.news/articles/the-disha-salian-case-is-back-the-politics-around-it-never-left/',
  'https://nter.news/articles/as-goa-heads-towards-the-polls-will-justice-finally-catch-up/',
  'https://nter.news/articles/the-water-before-the-summit-2/',
  'https://nter.news/articles/why-ant-nio-guterres-brics-summit-statement-matters-now/',
  'https://nter.news/articles/sweden-election-2026-the-far-right-is-no-longer-knocking-at-the-door-it-is-asking-for-the-keys/',
  'https://nter.news/articles/a-curious-case-of-claude-where-the-rules-apply-differently/',
  'https://nter.news/articles/brics-new-delhi-declaration-2026/',
  'https://nter.news/articles/a-prelude-to-brics-2026-from-diplomacy-to-deliverables/',
  'https://nter.news/articles/25-years-after-9-11-when-remembrance-became-a-battleground/',
  'https://nter.news/articles/kaziranga-s-next-battle-is-over-the-land-outside-the-park/',
  'https://nter.news/articles/trump-s-midterm-gamble-can-he-turn-himself-into-the-ballot/',
  'https://nter.news/articles/who-protects-children-online-the-legal-debate/',
  'https://nter.news/articles/brics-at-20-can-political-weight-become-economic-power/',
  'https://nter.news/articles/when-art-is-stolen-what-is-really-taken/',
  'https://nter.news/articles/critical-minerals-the-race-after-the-mine/',
  'https://nter.news/articles/the-west-asia-conflict-why-it-should-concern-us/',
  'https://nter.news/articles/the-terror-case-that-shrank-to-an-immigration-case/',
  'https://nter.news/articles/jharkhand-s-third-front-is-taking-shape/',
  'https://nter.news/articles/saxony-anhalt-has-changed-germany-s-political-equation/',
  'https://nter.news/articles/ukraine-s-war-enters-another-winter/',
  'https://nter.news/articles/manipur-s-nrc-moment/',
  'https://nter.news/articles/the-state-of-india-s-state-houses/',
  'https://nter.news/articles/germany-s-far-right-test-in-saxony-anhalt/',
  'https://nter.news/articles/delhi-is-collapsing-one-building-at-a-time/',
  'https://nter.news/articles/the-136-billion-masterstroke/',
  'https://nter.news/articles/india-s-new-european-moment/',
];

function loadUrls() {
  try {
    const p = 'C:/Users/hp/Downloads/NTER_News_51_Article_Links.txt';
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    }
  } catch {
    /* use embedded */
  }
  return FALLBACK_LINKS;
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

function pick(html, re) {
  const m = html.match(re);
  return m ? decode(m[1]).trim() : '';
}

function slugId(url) {
  const m = String(url).match(/\/articles\/([^/?#]+)/);
  return m ? m[1] : url;
}

function titleFromSlug(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function one(url) {
  const id = slugId(url);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'NiyantranTerminal/1.0' },
      signal: AbortSignal.timeout(25000),
    });
    const html = await r.text();
    const title =
      pick(html, /property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      pick(html, /content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
      pick(html, /<title>([^<]+)<\/title>/i).replace(/\s*[·•|].*nter\.news.*/i, '') ||
      titleFromSlug(id);
    const dek =
      pick(html, /name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      pick(html, /content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
      pick(html, /property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    let img =
      pick(html, /property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      pick(html, /content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
      pick(html, /class=["']article-figure["'][\s\S]{0,800}?src=["']([^"']+)["']/i) ||
      pick(html, /<img[^>]+src=["']([^"']*\/assets\/uploads\/[^"']+)["']/i) ||
      pick(html, /src=["']([^"']*uploads[^"']+\.(?:jpe?g|png|webp|gif))["']/i);
    if (img && img.startsWith('/')) img = `https://nter.news${img}`;
    else if (img && img.startsWith('//')) img = `https:${img}`;
    const cat = pick(html, /class=["']eyebrow[^"']*["']>([^<]+)</i);
    const pubRaw = pick(html, /<small>Published<\/small>([^<]+)/i);
    let pub = new Date().toISOString();
    if (pubRaw) {
      const d = new Date(pubRaw);
      if (Number.isFinite(d.getTime())) pub = d.toISOString();
    }
    return {
      id,
      article_id: id,
      title: title.trim(),
      link: url,
      pub,
      updated_at: pub,
      img: img || '',
      src: 'nter.news',
      site: 'https://nter.news',
      dek: String(dek || '').slice(0, 280),
      category: cat || '',
      tags: [],
      author: 'nter.news Desk',
      content: '',
      t: new Date(pub).getTime() || Date.now(),
      source: 'nter.news',
      fallback: true,
    };
  } catch (err) {
    return {
      id,
      article_id: id,
      title: titleFromSlug(id),
      link: url,
      pub: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      img: '',
      src: 'nter.news',
      site: 'https://nter.news',
      dek: '',
      category: '',
      tags: [],
      author: 'nter.news Desk',
      content: '',
      t: Date.now(),
      source: 'nter.news',
      fallback: true,
      fetch_error: err.message,
    };
  }
}

const urls = loadUrls();
const out = [];
for (let i = 0; i < urls.length; i += 6) {
  const batch = urls.slice(i, i + 6);
  const rows = await Promise.all(batch.map((u) => one(u)));
  out.push(...rows);
  console.log(`fetched ${out.length}/${urls.length}`);
}
out.sort((a, b) => (b.t || 0) - (a.t || 0));
const store = {
  updated: new Date().toISOString(),
  source: 'nter.news',
  note: 'Fallback seed from nter.news published articles. Live POST /api/news/ingest preferred.',
  rows: out,
};
const destPublic = path.join(ROOT, 'public', 'data', 'nter-news.json');
const destTmp = path.join(ROOT, 'tmp', 'nter-news.json');
fs.mkdirSync(path.dirname(destTmp), { recursive: true });
fs.writeFileSync(destPublic, `${JSON.stringify(store, null, 2)}\n`);
fs.writeFileSync(destTmp, `${JSON.stringify(store, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      count: out.length,
      withTitle: out.filter((r) => r.title && !r.fetch_error).length,
      withImg: out.filter((r) => r.img).length,
      errors: out.filter((r) => r.fetch_error).length,
      sample: out.slice(0, 3).map((r) => ({ title: r.title, pub: r.pub, img: r.img })),
    },
    null,
    2,
  ),
);
