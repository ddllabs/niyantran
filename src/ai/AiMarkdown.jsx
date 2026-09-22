import { splitCitationMarkers } from '../lib/citationMarkers.js';
import CitationBubble, { CitationPlaceholder, isReadableCitation } from './CitationBubble.jsx';

function Emphasis({ text, keyPrefix }) {
  const nodes = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let i = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i}`;
    if (m[1]) nodes.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) nodes.push(<em key={key}>{m[2]}</em>);
    else if (m[3]) nodes.push(<code key={key}>{m[3]}</code>);
    else if (m[4]) {
      nodes.push(
        <a key={key} href={m[5]} target="_blank" rel="noreferrer">
          {m[4]}
        </a>,
      );
    }
    i += 1;
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Inline markdown, and — on the research path — citation markers.
 * A marker whose source has arrived becomes a bubble; while the answer is
 * still streaming an unresolved one keeps a fixed-footprint placeholder so the
 * paragraph does not reflow; once the turn has finished, a marker with nothing
 * behind it is dropped, because a bracket with no bubble behind it is never
 * correct output.
 */
function Inline({ text, sources, streaming, onOpenSource, keyPrefix = 'i' }) {
  if (!sources && !streaming) return Emphasis({ text, keyPrefix });
  const byId = new Map((Array.isArray(sources) ? sources : []).filter(isReadableCitation).map((s) => [s.id, s]));
  const nodes = [];
  splitCitationMarkers(text).forEach((part, n) => {
    if (typeof part === 'string') {
      nodes.push(...Emphasis({ text: part, keyPrefix: `${keyPrefix}-${n}` }));
      return;
    }
    const source = byId.get(part.citation);
    if (source) nodes.push(<CitationBubble key={`${keyPrefix}-c${n}`} n={part.citation} source={source} onOpen={onOpenSource} />);
    else if (streaming) nodes.push(<CitationPlaceholder key={`${keyPrefix}-p${n}`} />);
  });
  return nodes;
}

// Block grammar. Everything a block renders goes through Inline, so emphasis
// and citation bubbles work the same in a table cell or a nested list item as
// in a paragraph.
const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
// A pipe row: starts with a pipe and has at least one more. A trailing pipe is
// optional, as it is in GFM.
const ROW = /^\s*\|.*\|/;
const RULE_CELL = /^:?-{2,}:?$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

const startsBlock = (line) => HEADING.test(line) || ITEM.test(line) || ROW.test(line) || QUOTE.test(line) || HR.test(line);
const indentOf = (s) => s.replace(/\t/g, '    ').length;

/**
 * Lines kept as lines. Paragraph lines used to be joined with a space, which is
 * right for prose that wraps and wrong for anything written one statement per
 * line - a timeline, a trap check, a run of labelled lines - all of which came
 * out as one run-on sentence. Answers are not hard-wrapped, so a newline the
 * model wrote is a line it meant.
 */
function Lines({ lines, keyPrefix, cite }) {
  const out = [];
  lines.forEach((line, n) => {
    if (n) out.push(<br key={`${keyPrefix}-br${n}`} />);
    out.push(<Inline key={`${keyPrefix}-l${n}`} text={line.trim()} keyPrefix={`${keyPrefix}-l${n}`} {...cite} />);
  });
  return out;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

/**
 * A pipe table. They used to fall into the paragraph branch and render as one
 * line of literal pipes, which is most of what a table-first answer format is.
 * Wrapped for horizontal scroll: a panel is narrow and a table is not.
 */
function Table({ rows, keyPrefix, cite }) {
  const cells = rows.map(splitRow);
  const ruled = cells.length > 1 && cells[1].length > 0 && cells[1].every((c) => RULE_CELL.test(c));
  const head = ruled ? cells[0] : null;
  const body = ruled ? cells.slice(2) : cells;
  const cell = (text, r, c) => <Inline text={text} keyPrefix={`${keyPrefix}-${r}-${c}`} {...cite} />;
  return (
    <div className="ai-md-table">
      <table>
        {head ? (
          <thead>
            <tr>{head.map((text, c) => <th key={c}>{cell(text, 'h', c)}</th>)}</tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>{row.map((text, c) => <td key={c}>{cell(text, r, c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One list, nested by indentation. Items used to be matched at column zero
 * only, so an indented sub-item fell out of its list into a paragraph - where
 * its `*` marker was then read as an italic delimiter, turning every nested
 * bullet into garbled emphasis. An indented line that is not an item continues
 * the item above it, which is how a numbered step carries a sub-line.
 */
function parseList(lines, from) {
  const roots = [];
  const stack = [];
  let i = from;
  let last = null;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line inside a list does not end it when the list carries on
      // after it. Ending it there split "1. … / 2. … / 3. …" written with blank
      // lines between into three lists, and each one rendered as "1."
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j < lines.length && (ITEM.test(lines[j]) || (last && /^\s+\S/.test(lines[j]) && !startsBlockAtRoot(lines[j])))) {
        i = j;
        continue;
      }
      break;
    }
    const item = ITEM.exec(line);
    if (item) {
      const node = {
        indent: indentOf(item[1]),
        ordered: /\d/.test(item[2]),
        number: /\d/.test(item[2]) ? Number.parseInt(item[2], 10) : null,
        lines: [item[3]],
        children: [],
      };
      while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
      last = node;
      i += 1;
      continue;
    }
    // Continuation of the item above: indented, and not the start of some
    // other block at the left margin.
    if (last && /^\s+\S/.test(line) && !startsBlockAtRoot(line)) {
      last.lines.push(line);
      i += 1;
      continue;
    }
    break;
  }
  return { roots, next: i };
}

/** A line that starts a block at the left margin - which ends a list rather than continuing it. */
function startsBlockAtRoot(line) {
  return !/^\s/.test(line) && startsBlock(line);
}

function ListItems({ items, keyPrefix, cite }) {
  // Consecutive siblings of one kind share a list; a switch from bullets to
  // numbers (or back) at the same depth starts a new one.
  const groups = [];
  for (const item of items) {
    const tail = groups[groups.length - 1];
    if (tail && tail.ordered === item.ordered) tail.items.push(item);
    else groups.push({ ordered: item.ordered, items: [item] });
  }
  return groups.map((group, g) => {
    const lis = group.items.map((item, n) => (
      <li key={n}>
        <Lines lines={item.lines} keyPrefix={`${keyPrefix}-${g}-${n}`} cite={cite} />
        {item.children.length ? <ListItems items={item.children} keyPrefix={`${keyPrefix}-${g}-${n}c`} cite={cite} /> : null}
      </li>
    ));
    if (!group.ordered) return <ul key={g}>{lis}</ul>;
    // Honour the number the model wrote, so a list interrupted by a table or a
    // paragraph resumes where it left off instead of at 1.
    const start = group.items[0].number;
    return <ol key={g} start={start && start !== 1 ? start : undefined}>{lis}</ol>;
  });
}

export default function AiMarkdown({ text, sources, streaming, onOpenSource }) {
  const cite = { sources, streaming, onOpenSource };
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const Tag = `h${Math.min(6, heading[1].length + 2)}`;
      out.push(
        <Tag key={`h${i}`}>
          <Inline text={heading[2]} keyPrefix={`h${i}`} {...cite} />
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (HR.test(line)) {
      i += 1;
      continue;
    }
    if (ROW.test(line)) {
      const rows = [];
      while (i < lines.length && ROW.test(lines[i])) rows.push(lines[i++]);
      out.push(<Table key={`t${i}`} rows={rows} keyPrefix={`t${i}`} cite={cite} />);
      continue;
    }
    if (ITEM.test(line)) {
      const { roots, next } = parseList(lines, i);
      out.push(<ListItems key={`l${i}`} items={roots} keyPrefix={`l${i}`} cite={cite} />);
      i = next;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])[1]);
      out.push(
        <blockquote key={`q${i}`}>
          <Lines lines={quoted} keyPrefix={`q${i}`} cite={cite} />
        </blockquote>,
      );
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={`p${i}`}>
        <Lines lines={para} keyPrefix={`p${i}`} cite={cite} />
      </p>,
    );
  }
  return <div className="ai-md">{out}</div>;
}
