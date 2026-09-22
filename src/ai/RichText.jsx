// One block of a document, rendered (RAG spec §H). The reader used to print the
// whole of ocr_text into a <pre>, so a stored HTML table showed as literal
// markup and a Markdown heading as a literal '#'.
//
// Security. The corpus is OCR output, not trusted HTML. Table markup is parsed
// with DOMParser and the resulting tree is WALKED into React elements: the
// string is never re-serialised, and there is no dangerouslySetInnerHTML and no
// innerHTML anywhere in this file. React escapes every text node it is given,
// and the walk emits only the tags and attributes on the two lists below, so
// the output is safe by construction and no sanitiser dependency is needed.
// Measured over the corpus (54,219 chunks): 0 carry <script>, onerror=,
// onclick= or javascript:, but 5,623 carry style=, 392 an <img> and 72 an <a>.
// All of those are dropped here anyway — the counts are today's, not a contract.

import { createElement, Fragment } from 'react';
import { HTML_TABLE } from './documentBlocks.js';

import './reader.css';

/** Emitted as themselves. Everything outside this list is unwrapped or dropped. */
const ALLOWED = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'br', 'p', 'b', 'i', 'em', 'strong', 'sub', 'sup', 'span',
]);

/** Allowed, but they take no children. */
const VOID = new Set(['br', 'col']);

/** Dropped with their whole subtree: their content is not document text. */
const DROPPED = new Set(['script', 'style', 'iframe', 'img', 'object', 'embed', 'svg']);

/** Table scaffolding. An HTML parser keeps the newlines between stored rows here; React rejects them. */
const STRUCTURE = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

/**
 * The only attributes that survive, and only on a cell, because they are the
 * only ones that carry meaning rather than OCR presentation: 1,590 chunks use
 * rowspan or colspan, and a tariff table is unreadable without them. style= is
 * dropped with everything else and the tables are styled from reader.css.
 */
function cellSpans(node) {
  const out = {};
  for (const [attribute, prop] of [['colspan', 'colSpan'], ['rowspan', 'rowSpan']]) {
    const raw = node.getAttribute(attribute);
    if (raw == null) continue;
    const count = Number(String(raw).trim());
    if (Number.isInteger(count) && count > 0) out[prop] = count;
  }
  return out;
}

/** One DOM node as React. Returns null for anything that leaves no trace. */
function toReact(node, key) {
  if (node.nodeType === 3) return node.data ?? '';
  if (node.nodeType !== 1) return null;
  const tag = String(node.tagName).toLowerCase();
  if (DROPPED.has(tag)) return null;
  const children = walk(node.childNodes, tag);
  // An unknown tag leaves its content behind rather than its markup. Unwrapping
  // rather than flattening to textContent keeps a table that OCR wrapped in a
  // <div> renderable, and is just as safe: the children are already walked.
  if (!ALLOWED.has(tag)) return <Fragment key={key}>{children}</Fragment>;
  const props = tag === 'td' || tag === 'th' ? { key, ...cellSpans(node) } : { key };
  return VOID.has(tag) ? createElement(tag, props) : createElement(tag, props, children);
}

function walk(nodes, parent) {
  const out = [];
  let i = 0;
  for (const node of nodes) {
    if (node.nodeType === 3 && STRUCTURE.has(parent) && !String(node.data ?? '').trim()) continue;
    const child = toReact(node, `n${i++}`);
    if (child !== null) out.push(child);
  }
  return out;
}

/** The stored markup as React elements, or null when this environment cannot parse it. */
function htmlNodes(source) {
  if (typeof DOMParser === 'undefined') return null;
  try {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    return walk(parsed.body.childNodes, 'body');
  } catch {
    return null;
  }
}

/**
 * A Markdown pipe table. Every line of a table block starts with '|' — that is
 * what made it a table block — so the rows are the lines, minus the '|---|' rule
 * that marks the line above it as the header.
 */
function markdownNodes(source, key) {
  const rows = source.split('\n').filter((line) => line.trim())
    .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
  if (!rows.length) return null;
  const ruled = rows.length > 1 && rows[1].every((cell) => /^:?-+:?$/.test(cell));
  const head = ruled ? rows[0] : null;
  const body = ruled ? rows.slice(2) : rows;
  return [
    <table key={key}>
      {head ? <thead><tr>{head.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead> : null}
      <tbody>{body.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody>
    </table>,
  ];
}

/**
 * The three-way slice the reader has always used to place its <mark>, now over
 * one block instead of the whole document. `base` is where `source` starts in
 * ocr_text, so `mark` stays in the document's coordinates throughout.
 */
function marked(source, base, mark, markRef) {
  if (!mark) return source;
  const from = Math.max(0, Math.min(source.length, mark.from - base));
  const to = Math.max(from, Math.min(source.length, mark.to - base));
  if (to <= from) return source;
  return (
    <>
      {source.slice(0, from)}
      <mark ref={markRef} className="ai-reader-mark">{source.slice(from, to)}</mark>
      {source.slice(to)}
    </>
  );
}

/**
 * @param {{
 *   text: string,
 *   kind: import('./documentBlocks.js').BlockKind,
 *   from: number,
 *   to: number,
 *   mark?: { from: number, to: number } | null,
 *   markRef?: import('react').Ref<HTMLElement> | null,
 * }} props   `from`/`to` are the range of `text` to render; the caller clips them to its window.
 */
export default function RichText({ text, kind, from, to, mark = null, markRef = null }) {
  const source = text.slice(from, to);

  if (kind === 'table') {
    // A table is marked whole: there is no character range inside a parsed tree
    // to slice, and the cited rows are the point anyway.
    const nodes = HTML_TABLE.test(source) ? htmlNodes(source) : markdownNodes(source, 't');
    if (nodes && nodes.length) {
      return (
        <div ref={markRef} className={mark ? 'ai-reader-table ai-reader-hit' : 'ai-reader-table'}>
          {nodes}
        </div>
      );
    }
    // Unparseable markup falls through and reads as text, which is what the
    // reader did for every block before this.
  }

  if (kind === 'heading') {
    const hashes = /^(#{1,6})\s+/.exec(source);
    if (hashes) {
      const tag = `h${Math.min(6, hashes[1].length + 3)}`;
      return createElement(tag, {}, marked(source.slice(hashes[0].length), from + hashes[0].length, mark, markRef));
    }
  }

  return <>{marked(source, from, mark, markRef)}</>;
}
