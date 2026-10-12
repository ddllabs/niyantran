import { documentRoleLabel, isTextCitation } from '../types/citation.js';

const MAX_PAGES = 5;

/**
 * The distinct cited documents, in first-citation order, each with its first citation, the
 * distinct pages cited and the citation numbers (the answer's bubbles) that point into it.
 */
export function documentChips(sources) {
  const chips = [];
  const byId = new Map();
  for (const s of sources ?? []) {
    if (!isTextCitation(s)) continue;
    let c = byId.get(s.document_id);
    if (!c) {
      c = { document_id: s.document_id, title: s.title, version: documentRoleLabel(s.document_role), file_name: s.file_name, desk_feature: s.desk_feature, first: s, pages: [], ids: [] };
      byId.set(s.document_id, c);
      chips.push(c);
    }
    if (Number.isSafeInteger(s.page_number) && !c.pages.includes(s.page_number)) c.pages.push(s.page_number);
    if (!c.ids.includes(s.id)) c.ids.push(s.id);
  }
  for (const c of chips) {
    c.pages.sort((a, b) => a - b);
    c.ids.sort((a, b) => a - b);
  }
  return chips;
}

const titleKey = (title) => String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * F118: the cited documents grouped by bill. Versions of one bill share its title and module, so they
 * share a card; each document keeps a tag (its version, marked PDF where it opens in the page
 * viewer). Groups and their documents keep first-citation order; ids and pages are merged.
 */
export function sourceGroups(sources) {
  const groups = [];
  const byKey = new Map();
  for (const c of documentChips(sources)) {
    const key = `${titleKey(c.title)}\u0000${c.desk_feature ?? ''}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: c.title, desk_feature: c.desk_feature, first: c.first, docs: [], pages: [], ids: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    const pdf = c.pages.length > 0;
    g.docs.push({ ...c, tag: [c.version || 'Document', pdf ? 'PDF' : ''].filter(Boolean).join(' · ') });
    for (const p of c.pages) if (!g.pages.includes(p)) g.pages.push(p);
    for (const id of c.ids) if (!g.ids.includes(id)) g.ids.push(id);
  }
  for (const g of groups) {
    g.pages.sort((a, b) => a - b);
    g.ids.sort((a, b) => a - b);
  }
  return groups;
}

/** "p. 2", "pp. 3, 5, 7", or the first five then "+N"; '' with no pages. */
function pageLabel(pages, hi) {
  if (!pages.length) return '';
  const shown = pages.slice(0, MAX_PAGES).join(', ');
  const more = pages.length > MAX_PAGES ? ` +${pages.length - MAX_PAGES}` : '';
  const prefix = hi ? 'पृ.' : pages.length === 1 ? 'p.' : 'pp.';
  return `${prefix} ${shown}${more}`;
}

const DocGlyph = () => (
  <svg className="ai-source-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

const Chevron = () => (
  <svg className="ai-source-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * The cited documents as one compact list (source-list spec, F65 amendment). A row opens
 * its first citation; numbered labels stay inline in the row. File name is tooltip only. A bill
 * cited in several versions is one row (F118) with a tag per version that opens that version.
 *
 * @param {{ sources: import('../types/citation.js').CitationSource[], onOpen?: (c: import('../types/citation.js').TextCitation) => void, lang?: string }} props
 */
export default function SourceList({ sources, onOpen, lang }) {
  const groups = sourceGroups(sources);
  if (!groups.length) return null;
  const hi = lang === 'hi';
  const count = hi ? `${groups.length} दस्तावेज़` : `${groups.length} document${groups.length === 1 ? '' : 's'}`;
  return (
    <section className="ai-sources-block">
      <p className="ai-sources-label">{hi ? 'स्रोत' : 'Sources'} · {count}</p>
      <ul className="ai-sources" aria-label={hi ? 'स्रोत' : 'Sources'}>
        {groups.map((g) => {
          const pages = pageLabel(g.pages, hi);
          const single = g.docs.length === 1 ? g.docs[0] : null;
          return (
            <li key={g.key}>
              <button type="button" className="ai-source-chip" onClick={() => onOpen?.(g.first)} title={single ? single.file_name || single.title : g.title}>
                <DocGlyph />
                <span className="ai-source-main">
                  <span className="ai-source-title">{g.title}</span>
                  <span className="ai-source-meta">
                    {single?.version ? <span className="ai-source-version">{single.version}</span> : null}
                    {g.desk_feature ? <span>{g.desk_feature}</span> : null}
                    {pages ? <span>{pages}</span> : null}
                    <span className="ai-source-ids">
                      {hi ? 'उद्धरण' : 'cited'}
                      {g.ids.map(id => <span key={id} className="ai-source-id">{id}</span>)}
                    </span>
                  </span>
                </span>
                <Chevron />
              </button>
              {single ? null : (
                <div className="ai-source-versions" role="group" aria-label={hi ? 'संस्करण' : 'Versions'}>
                  {g.docs.map((d) => (
                    <button
                      key={d.document_id}
                      type="button"
                      className="ai-source-version-tag"
                      onClick={() => onOpen?.(d.first)}
                      title={d.file_name || d.title}
                      aria-label={`${hi ? 'खोलें' : 'Open'} ${d.tag}`}
                    >
                      {d.tag}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
