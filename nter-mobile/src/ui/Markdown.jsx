// Renders an AI answer: headings, lists, tables, quotes, emphasis, links, and the [n] citation
// markers nter.pro's research-chat writes, drawn as tappable bubbles. No HTML from the answer is
// ever injected.
import { splitCitationMarkers } from '../lib/citationMarkers.js';

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const ROW = /^\s*\|.*\|/;
const RULE_CELL = /^:?-{2,}:?$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const startsBlock = (l) => HEADING.test(l) || ITEM.test(l) || ROW.test(l) || QUOTE.test(l) || HR.test(l);

function Emphasis({ text, k }) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((https:\/\/[^\s)]+)\)/g;
  let last = 0; let i = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${k}-${i++}`;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={key}>{m[2]}</em>);
    else if (m[3]) out.push(<code key={key}>{m[3]}</code>);
    else if (m[4]) out.push(<a key={key} href={m[5]} target="_blank" rel="noreferrer noopener" onClick={(e) => { if (window.__nterOpen) { e.preventDefault(); window.__nterOpen(m[5]); } }}>{m[4]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Inline({ text, k, cite }) {
  if (!cite) return <Emphasis text={text} k={k} />;
  return splitCitationMarkers(text).map((part, n) => {
    if (typeof part === 'string') return <Emphasis key={`${k}-s${n}`} text={part} k={`${k}-s${n}`} />;
    const has = cite.ids.has(part.citation);
    if (!has) return cite.streaming ? <span key={`${k}-c${n}`} className="cite pend" aria-hidden="true">·</span> : null;
    return <button key={`${k}-c${n}`} type="button" className="cite btn" onClick={() => cite.onOpen(part.citation)} aria-label={`Source ${part.citation}`}>{part.citation}</button>;
  });
}

function parseList(lines, start) {
  const items = [];
  let i = start;
  const baseIndent = ITEM.exec(lines[i])[1].length;
  const ordered = /\d/.test(ITEM.exec(lines[i])[2]);
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m) {
      if (lines[i].trim() && !startsBlock(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
      break;
    }
    const indent = m[1].length;
    if (indent > baseIndent && items.length) {
      const sub = parseList(lines, i);
      items[items.length - 1].children = sub.list;
      i = sub.next;
      continue;
    }
    if (indent < baseIndent) break;
    items.push({ text: m[3], children: null });
    i++;
  }
  return { list: { ordered, items }, next: i };
}

function List({ list, k, cite }) {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {list.items.map((it, n) => (
        <li key={n}><Inline text={it.text} k={`${k}-${n}`} cite={cite} />{it.children ? <List list={it.children} k={`${k}-${n}c`} cite={cite} /> : null}</li>
      ))}
    </Tag>
  );
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export default function Markdown({ text, sources, streaming = false, onOpenSource }) {
  const ids = new Set((sources || []).map((s) => s?.id).filter((n) => Number.isInteger(n)));
  const cite = sources || streaming ? { ids, streaming, onOpen: onOpenSource || (() => {}) } : null;
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const k = `b${i}`;
    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(5, Math.max(3, h[1].length + 1));
      const Tag = `h${level}`;
      out.push(<Tag key={k}><Inline text={h[2]} k={k} cite={cite} /></Tag>);
      i++; continue;
    }
    if (HR.test(line)) { out.push(<hr key={k} />); i++; continue; }
    if (ROW.test(line)) {
      const rows = [];
      while (i < lines.length && ROW.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      const hasRule = rows[1] && rows[1].every((c) => RULE_CELL.test(c));
      const head = hasRule ? rows[0] : null;
      const body = hasRule ? rows.slice(2) : rows;
      out.push(
        <div key={k} className="tbl"><table>
          {head ? <thead><tr>{head.map((c, n) => <th key={n}><Inline text={c} k={`${k}h${n}`} cite={cite} /></th>)}</tr></thead> : null}
          <tbody>{body.map((r, rn) => <tr key={rn}>{r.map((c, n) => <td key={n}><Inline text={c} k={`${k}-${rn}-${n}`} cite={cite} /></td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (ITEM.test(line)) {
      const { list, next } = parseList(lines, i);
      out.push(<List key={k} list={list} k={k} cite={cite} />);
      i = next; continue;
    }
    if (QUOTE.test(line)) {
      const q = [];
      while (i < lines.length && QUOTE.test(lines[i])) { q.push(QUOTE.exec(lines[i])[1]); i++; }
      out.push(<blockquote key={k}>{q.map((l, n) => <div key={n}><Inline text={l} k={`${k}-${n}`} cite={cite} /></div>)}</blockquote>);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(<p key={k}>{para.map((l, n) => <span key={n}>{n ? <br /> : null}<Inline text={l} k={`${k}-${n}`} cite={cite} /></span>)}</p>);
  }
  return <div className="md">{out}</div>;
}

// Plain text of an answer for copying and exporting: markers and markdown marks removed.
export function plainText(text) {
  return String(text || '')
    .replace(/\[([0-9](?:[0-9\s,–-]*[0-9])?)\](?!\()/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n');
}
