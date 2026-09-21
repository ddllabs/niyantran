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
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const Tag = heading[1].length === 1 ? 'h3' : heading[1].length === 2 ? 'h4' : 'h5';
      out.push(
        <Tag key={`h${i}`}>
          <Inline text={heading[2]} keyPrefix={`h${i}`} {...cite} />
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const numbered = /^\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (numbered ? /^\d+\.\s+/.test(lines[i]) : /^[-*]\s+/.test(lines[i]))) {
        items.push(
          <li key={i}>
            <Inline text={lines[i].replace(/^([-*]|\d+\.)\s+/, '')} keyPrefix={`li${i}`} {...cite} />
          </li>,
        );
        i += 1;
      }
      out.push(numbered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      i += 1;
      continue;
    }
    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      <p key={`p${i}`}>
        <Inline text={para.join(' ')} keyPrefix={`p${i}`} {...cite} />
      </p>,
    );
  }
  return <div className="ai-md">{out}</div>;
}
