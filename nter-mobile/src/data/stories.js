// nter.news stories as the feed returns them (/api/home/latest), shaped for the cards.
import { asset } from '../lib/asset.js';
const NEWS = 'https://nter.news';

const SECTION_DESK = [
  [/national|parliament|india|politic/i, 'national'],
  [/global|world|geopolit|international|war|diplom/i, 'global'],
  [/state|bengal|kerala|tamil|punjab|bihar|uttar|maharashtra|karnataka|assam/i, 'state'],
  [/law|court|judic|legal|justice/i, 'law'],
  [/econom|market|business|finance|budget|trade/i, 'economics'],
  [/climate|carbon|energy|environment/i, 'carbon'],
  [/sport|cricket|football/i, 'sports'],
  [/entertain|film|cinema|culture|music/i, 'entertainment'],
];

export function deskForCategory(category) {
  for (const [re, desk] of SECTION_DESK) if (re.test(String(category || ''))) return desk;
  return 'national';
}

export function storySection(category) {
  const parts = String(category || '').split('·').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'News';
}

function imgUrl(img) {
  const s = String(img || '');
  if (!s) return '';
  if (/^https:\/\//i.test(s)) return s;
  if (s.startsWith('/sample-news/')) return asset(s);
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${NEWS}${s}`;
  return '';
}

export function normalizeStory(r, i = 0) {
  const when = r.published_at || r.pub || '';
  const t = Date.parse(when);
  const words = String(r.body || r.dek || '').split(/\s+/).length;
  return {
    id: String(r.id || r.article_id || `story-${i}`),
    title: String(r.title || '').trim(),
    dek: String(r.dek || '').trim(),
    body: String(r.body || '').trim(),
    img: imgUrl(r.img),
    link: /^https:\/\//i.test(r.link || '') ? r.link : (r.source_url && /^https:\/\//i.test(r.source_url) ? r.source_url : NEWS),
    category: String(r.category || 'News'),
    section: storySection(r.category),
    date: Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : String(r.pub || ''),
    mins: Number(r.mins) || (words > 120 ? Math.max(2, Math.round(words / 220)) : null),
    author: String(r.author || '').trim(),
    desk: r.desk || deskForCategory(r.category),
    lead: Boolean(r.lead),
  };
}
