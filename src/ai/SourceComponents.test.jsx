import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CitationBubble from './CitationBubble.jsx';
import SourceList, { documentChips, sourceGroups } from './SourceList.jsx';
import SourceReader, * as reader from './SourceReader.jsx';

const text = (id, document_id, title, extra = {}) => ({
  id, kind: 'text', chunk_id: `c${id}`, document_id, title, char_from: 0, char_to: 5, text_hash: 'h', source_kind: 'document', ...extra,
});
const row = { id: 9, kind: 'row', tier: 'national', feature: 'Bills', row_key: 'k', title: 'A bill', row_snapshot: {}, snapshot_at: null };

describe('SourceList', () => {
  it('renders one chip per distinct document, in first-citation order, ignoring row citations', () => {
    const sources = [text(1, 'd2', 'Second doc'), text(2, 'd1', 'First doc', { file_name: 'first.pdf' }), text(3, 'd2', 'Second doc'), row];
    expect(documentChips(sources).map((c) => c.document_id)).toEqual(['d2', 'd1']);
    expect(documentChips(sources)[0].first.id).toBe(1);
    const html = renderToStaticMarkup(<SourceList sources={sources} />);
    expect(html.match(/ai-source-chip/g)).toHaveLength(2);
    expect(html.indexOf('Second doc')).toBeLessThan(html.indexOf('First doc'));
  });

  // source-list spec: the storage file name was a visible second line ("Windows 98"); it is now
  // the tooltip only, and the row says which pages and bubbles belong to the document.
  const page = (id, document_id, page_number, extra = {}) => text(id, document_id, 'A bill', { source_kind: 'pdf_page', page_number, ...extra });

  it('groups each document\'s pages and citation numbers, ascending and distinct', () => {
    const sources = [page(24, 'd1', 7), page(23, 'd1', 3), page(2, 'd2', 2), page(25, 'd1', 3)];
    const [a, b] = documentChips(sources);
    expect(a.pages).toEqual([3, 7]);
    expect(a.ids).toEqual([23, 24, 25]);
    expect(b.pages).toEqual([2]);
    expect(b.ids).toEqual([2]);
    expect(documentChips([text(1, 'd1', 'Doc')])[0].pages).toEqual([]);
  });

  // F116: two versions of one bill share a title; the row names the version, from a known role only.
  it('names the version of each document, and ignores an unknown role', () => {
    const sources = [
      text(1, 'd1', 'THE ANTI-DOPING BILL, 2025', { document_role: 'as_introduced' }),
      text(2, 'd2', 'THE SPORTS BILL, 2025', { document_role: 'as_passed_lok_sabha' }),
      text(3, 'd3', 'THE GAMING BILL, 2025', { document_role: '<b>forged</b>' }),
    ];
    expect(documentChips(sources).map((c) => c.version)).toEqual(['As introduced', 'As passed by Lok Sabha', '']);
    expect(documentChips([text(9, 'd9', 'A BILL', { document_role: 'synopsis' })])[0].version).toBe('Synopsis');
    const html = renderToStaticMarkup(<SourceList sources={sources} />);
    expect(html).toContain('<span class="ai-source-version">As introduced</span>');
    expect(html).toContain('<span class="ai-source-version">As passed by Lok Sabha</span>');
    expect(html).not.toContain('forged');
    expect(html.match(/ai-source-version/g)).toHaveLength(2);
  });

  // F118 (owner, 2026-10-13): a bill cited in several versions was a wall of identical cards. Versions
  // of one bill (same title and module) share one card, with a tag per version that opens it.
  describe('one card per bill', () => {
    const BILL = 'THE NATIONAL ANTI-DOPING (AMENDMENT) BILL, 2025';
    const f = { desk_feature: 'Bill Passage Probability Index' };
    const versions = [
      text(1, 'pdf', BILL, { ...f, source_kind: 'pdf_page', page_number: 12, document_role: 'as_introduced', file_name: 'intro.pdf' }),
      text(2, 'intro', BILL, { ...f, document_role: 'as_introduced' }),
      text(3, 'ls', `  ${BILL.toLowerCase()} `, { ...f, document_role: 'as_passed_lok_sabha' }),
      text(4, 'both', BILL, { ...f, document_role: 'as_passed_both_houses' }),
      text(5, 'pdf', BILL, { ...f, source_kind: 'pdf_page', page_number: 1, document_role: 'as_introduced' }),
      text(6, 'other', 'THE SPORTS BILL, 2025', f),
    ];

    it('groups the versions of one bill, in first-citation order, and keeps other documents apart', () => {
      const groups = sourceGroups(versions);
      expect(groups.map((g) => g.docs.map((d) => d.document_id))).toEqual([['pdf', 'intro', 'ls', 'both'], ['other']]);
      expect(groups[0].ids).toEqual([1, 2, 3, 4, 5]);
      expect(groups[0].docs.map((d) => d.tag)).toEqual(['As introduced · PDF', 'As introduced', 'As passed by Lok Sabha', 'As passed by both Houses']);
    });

    // F52 (F171 B14): a malformed stored title is shown tidied, and its versions still share a card.
    it('shows a malformed title tidied and groups its versions together', () => {
      const raw = 'The Farmers (Old Age Allowance Bill,2000';
      const groups = sourceGroups([text(1, 'a', raw, f), text(2, 'b', 'The Farmers (Old Age Allowance) Bill, 2000', f)]);
      expect(groups).toHaveLength(1);
      const html = renderToStaticMarkup(<SourceList sources={[text(1, 'a', raw, f)]} />);
      expect(html).toContain('The Farmers (Old Age Allowance) Bill, 2000');
      expect(html).not.toContain('Allowance Bill,2000');
    });

    it('does not merge the same title from different modules', () => {
      const groups = sourceGroups([text(1, 'a', BILL, f), text(2, 'b', BILL, { desk_feature: 'Policy Intelligence Graph' })]);
      expect(groups).toHaveLength(2);
    });

    it('renders one card with a tag per version and counts the bill once', () => {
      const html = renderToStaticMarkup(<SourceList sources={versions} />);
      expect(html.match(/class="ai-source-chip"/g)).toHaveLength(2);
      expect(html).toContain('Sources · 2 documents');
      expect(html.match(/class="ai-source-version-tag"/g)).toHaveLength(4);
      expect(html).toContain('aria-label="Open As passed by Lok Sabha"');
      expect(html).toContain('>As introduced · PDF<');
      expect(html.indexOf('ai-source-versions')).toBeGreaterThan(html.indexOf('</button>'));
    });

    it('a single document keeps its card as before, with the version in the meta line and no tags', () => {
      const html = renderToStaticMarkup(<SourceList sources={[versions[1]]} />);
      expect(html).toContain('<span class="ai-source-version">As introduced</span>');
      expect(html).not.toContain('ai-source-versions');
    });
  });

  it('shows the file name only as the tooltip', () => {
    const html = renderToStaticMarkup(<SourceList sources={[text(1, 'd1', 'First doc', { file_name: 'first.pdf' })]} />);
    expect(html).toContain('title="first.pdf"');
    expect(html).not.toContain('>first.pdf<');
    expect(html).not.toContain('ai-source-file');
  });

  it('labels the list with its document count', () => {
    expect(renderToStaticMarkup(<SourceList sources={[text(1, 'd1', 'A')]} />)).toContain('Sources · 1 document<');
    expect(renderToStaticMarkup(<SourceList sources={[text(1, 'd1', 'A'), text(2, 'd2', 'B')]} />)).toContain('Sources · 2 documents<');
    expect(renderToStaticMarkup(<SourceList lang="hi" sources={[text(1, 'd1', 'A')]} />)).toContain('स्रोत · 1 दस्तावेज़<');
  });

  it('writes the meta line: feature, pages (p., pp., +N after five), then the citation numbers', () => {
    const one = renderToStaticMarkup(<SourceList sources={[page(2, 'd1', 2, { desk_feature: 'Bills' })]} />);
    expect(one).toContain('Bills');
    expect(one).toContain('p. 2<');
    expect(one).toContain('Cited passages');
    expect(one).toContain('aria-label="Source 2: A bill — Bills"');
    const many = renderToStaticMarkup(<SourceList sources={[1, 2, 3, 4, 5, 6, 7].map((n) => page(n, 'd1', n * 2))} />);
    expect(many).toContain('pp. 2, 4, 6, 8, 10 +2<');
    expect(renderToStaticMarkup(<SourceList sources={[text(1, 'd1', 'A')]} />)).not.toMatch(/p\. |pp\. /);
  });

  it('renders nothing without text sources', () => {
    expect(renderToStaticMarkup(<SourceList sources={[row]} />)).toBe('');
    expect(renderToStaticMarkup(<SourceList sources={[]} />)).toBe('');
  });
});

describe('SourceReader', () => {
  it('renders the citation header and the loading state before the document arrives', () => {
    const never = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) };
    const html = renderToStaticMarkup(<SourceReader citation={text(1, 'd1', 'Gazette 2005', { file_name: '2005-115-gaz.pdf' })} client={never} />);
    expect(html).toContain('Gazette 2005');
    expect(html).toContain('2005-115-gaz.pdf');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Open file');
  });
});

it('SourceReader does not turn unsafe citation URLs into links',()=>{
 for(const file_url of ['javascript:alert(1)','data:text/html,hi','//evil.invalid','file:///private/file']){
 const html=renderToStaticMarkup(<SourceReader citation={text(1,'d','Document',{file_url})}/>);expect(html).not.toContain('Open file');expect(html).not.toContain('href=');
 }
});

it('reader fetch rejection becomes a visible safe error state',async()=>{
 const state=await reader.loadSource(text(1,'d','Document'),{from(){throw Error('PRIVATE transport failure')}});
 expect(state).toMatchObject({loading:false,doc:null,span:null});expect(state.error).toBeTruthy();expect(state.error).not.toContain('PRIVATE');
});
it('loaded document links are sanitized and exact span checking remains intact',async()=>{
 const citation=text(1,'d','Document',{char_to:5,text_hash:'wrong'});
 const client={from:table=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='documents'?{ocr_text:'Hello world',file_url:'javascript:alert(1)'}:{content:'Hello'}})})};
 const state=await reader.loadSource(citation,client);expect(state.error).toBe('');expect(state.doc.file_url).toBeNull();expect(state.span.status).toBe('changed');
});

// Revision 5 point 4 (F45): "Ask about this document" is disabled when the cited document is gone.
// The reader reports what it found through onDocumentState: 'gone' with no row, 'ok' once loaded.
describe('SourceReader document state', () => {
  const rows = docs => ({ from: table => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: table === 'documents' ? docs : { content: 'Hello' } }) }) });

  it('reports gone when the document row is missing (the "no longer available" branch)', async () => {
    const seen = [];
    const state = await reader.readSource(text(1, 'd', 'Document'), rows(null), () => true, s => seen.push(s));
    expect(state.error).toContain('no longer available');
    expect(seen).toEqual(['gone']);
  });

  it('reports ok when the document loads', async () => {
    const seen = [];
    await reader.readSource(text(1, 'd', 'Document'), rows({ ocr_text: 'Hello world' }), () => true, s => seen.push(s));
    expect(seen).toEqual(['ok']);
  });

  it('reports nothing for a failed read (not known to be gone) or a stale one', async () => {
    const seen = [];
    await reader.readSource(text(1, 'd', 'Document'), { from() { throw Error('down'); } }, () => true, s => seen.push(s));
    await reader.readSource(text(1, 'd', 'Document'), rows(null), () => false, s => seen.push(s));
    expect(seen).toEqual([]);
  });

  it('works without a callback', async () => {
    await expect(reader.readSource(text(1, 'd', 'Document'), rows(null), () => true)).resolves.toMatchObject({ doc: null });
  });
});

it('offers Open citations and independent exact passage buttons outside the document action', () => {
  const sources = [text(1, 'd', 'Evidence'), text(2, 'd', 'Evidence', { char_from: 8, char_to: 12 })];
  const html = renderToStaticMarkup(<SourceList sources={sources} selectedSource={sources[1]} />);
  expect(html).toContain('Open citations');
  expect(html).toContain('aria-label="Source 2: Evidence"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).not.toMatch(/<button[^>]*class="ai-source-chip"[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
});

// ---- F332: the publisher on the chip and the source-list bubble ----------------------------------------------------

describe('the publisher in the source list (F332)', () => {
  const RBI = 'Reserve Bank of India';
  const SEBI = 'Securities and Exchange Board of India';
  const REG = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
  const reg = (id, document_id, extra = {}) => text(id, document_id, 'Master Direction on KYC', { desk_feature: REG, ...extra });

  // Recorded on the code before the field existed (main 4535abab): a saved message without the key renders as it did.
  const OLD_SOURCES = [
    text(1, 'd1', 'THE ANTI-DOPING BILL, 2025', { desk_feature: 'Bill Passage Probability Index', document_role: 'as_introduced', file_name: 'a.pdf' }),
    text(2, 'd2', 'THE ANTI-DOPING BILL, 2025', { desk_feature: 'Bill Passage Probability Index', document_role: 'as_passed_lok_sabha', source_kind: 'pdf_page', page_number: 3 }),
    text(3, 'd3', 'Circular on KYC', { desk_feature: REG, source_kind: 'pdf_page', page_number: 9, file_url: 'https://rbidocs.rbi.org.in/x.pdf' }),
    text(4, 'd4', 'Plain'),
  ];
  const OLD_HTML = "<section class=\"ai-sources-block\"><p class=\"ai-sources-label\">Sources \u00b7 3 documents</p><ul class=\"ai-sources\" aria-label=\"Sources\"><li><button type=\"button\" class=\"ai-source-chip\" title=\"THE ANTI-DOPING BILL, 2025\"><svg class=\"ai-source-icon\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"></path><path d=\"M14 3v5h5M9 13h6M9 17h4\"></path></svg><span class=\"ai-source-main\"><span class=\"ai-source-title\">THE ANTI-DOPING BILL, 2025</span><span class=\"ai-source-meta\"><span>Bill Passage Probability Index</span><span>p. 3</span></span></span><span class=\"ai-source-action\">Open citations<svg class=\"ai-source-go\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M9 6l6 6-6 6\"></path></svg></span></button><div class=\"ai-source-citations\" role=\"group\" aria-label=\"Citations\"><span>Cited passages</span><button type=\"button\" class=\"cite-bubble\" aria-pressed=\"false\" title=\"THE ANTI-DOPING BILL, 2025 \u2014 Bill Passage Probability Index \u00b7 As introduced\" aria-label=\"Source 1: THE ANTI-DOPING BILL, 2025 \u2014 Bill Passage Probability Index\">1</button><button type=\"button\" class=\"cite-bubble\" aria-pressed=\"false\" title=\"THE ANTI-DOPING BILL, 2025 \u2014 Bill Passage Probability Index \u00b7 As passed by Lok Sabha \u00b7 Page 3\" aria-label=\"Source 2: THE ANTI-DOPING BILL, 2025 \u2014 Bill Passage Probability Index\">2</button></div><div class=\"ai-source-versions\" role=\"group\" aria-label=\"Versions\"><button type=\"button\" class=\"ai-source-version-tag\" title=\"a.pdf\" aria-label=\"Open As introduced\">As introduced</button><button type=\"button\" class=\"ai-source-version-tag\" title=\"THE ANTI-DOPING BILL, 2025\" aria-label=\"Open As passed by Lok Sabha \u00b7 PDF\">As passed by Lok Sabha \u00b7 PDF</button></div></li><li><button type=\"button\" class=\"ai-source-chip\" title=\"Circular on KYC\"><svg class=\"ai-source-icon\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"></path><path d=\"M14 3v5h5M9 13h6M9 17h4\"></path></svg><span class=\"ai-source-main\"><span class=\"ai-source-title\">Circular on KYC</span><span class=\"ai-source-meta\"><span>Regulatory Body Watch (RBI SEBI TRAI CCI)</span><span>p. 9</span></span></span><span class=\"ai-source-action\">Open citations<svg class=\"ai-source-go\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M9 6l6 6-6 6\"></path></svg></span></button><div class=\"ai-source-citations\" role=\"group\" aria-label=\"Citations\"><span>Cited passages</span><button type=\"button\" class=\"cite-bubble\" aria-pressed=\"false\" title=\"Circular on KYC \u2014 Regulatory Body Watch (RBI SEBI TRAI CCI) \u00b7 Page 9\" aria-label=\"Source 3: Circular on KYC \u2014 Regulatory Body Watch (RBI SEBI TRAI CCI)\">3</button></div></li><li><button type=\"button\" class=\"ai-source-chip\" title=\"Plain\"><svg class=\"ai-source-icon\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"></path><path d=\"M14 3v5h5M9 13h6M9 17h4\"></path></svg><span class=\"ai-source-main\"><span class=\"ai-source-title\">Plain</span><span class=\"ai-source-meta\"></span></span><span class=\"ai-source-action\">Open citations<svg class=\"ai-source-go\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M9 6l6 6-6 6\"></path></svg></span></button><div class=\"ai-source-citations\" role=\"group\" aria-label=\"Citations\"><span>Cited passages</span><button type=\"button\" class=\"cite-bubble\" aria-pressed=\"false\" title=\"Plain\" aria-label=\"Source 4: Plain\">4</button></div></li></ul></section>";

  it('a saved message without the key renders the markup it rendered before', () => {
    expect(renderToStaticMarkup(<SourceList sources={OLD_SOURCES} />)).toBe(OLD_HTML);
    expect(renderToStaticMarkup(<SourceList lang="hi" sources={OLD_SOURCES} />)).not.toContain('ai-source-publisher');
  });

  it('the chip shows "Published by <name>" before the feature; Hindi uses the Hindi label', () => {
    const html = renderToStaticMarkup(<SourceList sources={[reg(1, 'd1', { publisher: RBI, source_kind: 'pdf_page', page_number: 4 })]} />);
    expect(html).toContain(`<span class="ai-source-publisher">Published by ${RBI}</span>`);
    expect(html.indexOf('ai-source-publisher')).toBeLessThan(html.indexOf(REG));
    expect(html.indexOf(REG)).toBeLessThan(html.indexOf('p. 4'));
    const hi = renderToStaticMarkup(<SourceList lang="hi" sources={[reg(1, 'd1', { publisher: RBI })]} />);
    expect(hi).toContain(`<span class="ai-source-publisher">प्रकाशक: ${RBI}</span>`);
    expect(hi).not.toContain('class="ai-source-publisher">Published by');
    // The bubble's label is English in v1 (it is not passed a language).
    expect(hi).toContain(`· Published by ${RBI}"`);
  });

  it('a card of two versions with one publisher shows it; with two publishers, or one missing, it shows none', () => {
    const f = { desk_feature: 'Bill Passage Probability Index' };
    const v = (id, document_id, extra) => text(id, document_id, 'THE SPORTS BILL, 2025', { ...f, ...extra });
    const same = [v(1, 'a', { document_role: 'as_introduced', publisher: RBI }), v(2, 'b', { document_role: 'as_passed_lok_sabha', publisher: RBI })];
    expect(sourceGroups(same)).toHaveLength(1);
    expect(sourceGroups(same)[0].publisher).toBe(RBI);
    expect(renderToStaticMarkup(<SourceList sources={same} />)).toContain(`Published by ${RBI}`);
    const differ = [v(1, 'a', { document_role: 'as_introduced', publisher: RBI }), v(2, 'b', { document_role: 'as_passed_lok_sabha', publisher: SEBI })];
    expect(sourceGroups(differ)[0].publisher).toBe('');
    expect(renderToStaticMarkup(<SourceList sources={differ} />)).not.toContain('ai-source-publisher');
    const oneMissing = [v(1, 'a', { document_role: 'as_introduced', publisher: RBI }), v(2, 'b', { document_role: 'as_passed_lok_sabha' })];
    expect(sourceGroups(oneMissing)[0].publisher).toBe('');
    expect(renderToStaticMarkup(<SourceList sources={oneMissing} />)).not.toContain('ai-source-publisher');
    // Grouping is unchanged by the publisher: the two documents still share one card.
    expect(sourceGroups(differ)).toHaveLength(1);
  });

  it('an invalid publisher is not shown on the chip', () => {
    for (const bad of ['', 7, {}, 'x'.repeat(81), 'A\nB', 'ref:abc123-1']) {
      expect(renderToStaticMarkup(<SourceList sources={[reg(1, 'd1', { publisher: bad })]} />), JSON.stringify(bad)).not.toContain('ai-source-publisher');
    }
  });

  it('the source-list bubble names the publisher in its tooltip only; an inline marker does not', () => {
    const source = reg(1, 'd1', { publisher: RBI });
    const listed = renderToStaticMarkup(<SourceList sources={[source]} />);
    // The chip announces the publisher once; the bubble keeps it in its tooltip only.
    expect(listed).toContain(`aria-label="Source 1: Master Direction on KYC — ${REG}"`);
    expect(listed).not.toContain(`aria-label="Source 1: Master Direction on KYC — ${REG} · Published by`);
    expect(listed).toContain(`title="Master Direction on KYC — ${REG} · Published by ${RBI}"`);
    const inline = renderToStaticMarkup(<CitationBubble n={1} source={source} />);
    expect(inline).toContain(`aria-label="Source 1: Master Direction on KYC — ${REG}"`);
    expect(inline).toContain(`title="Master Direction on KYC — ${REG}"`);
    expect(inline).not.toContain('Published by');
    // A citation without a publisher keeps its label.
    const plain = renderToStaticMarkup(<CitationBubble showContext n={1} source={reg(1, 'd1')} />);
    expect(plain).toContain(`aria-label="Source 1: Master Direction on KYC — ${REG}"`);
    expect(plain).not.toContain('Published by');
    // A row citation never carries one.
    expect(renderToStaticMarkup(<CitationBubble showContext n={9} source={{ ...row, publisher: RBI }} />)).not.toContain('Published by');
  });
});

describe('a Hindi chip beside an English tooltip (F332, FU5)', () => {
  it('localises the chip only: the bubble tooltip in the same card stays English', () => {
    const source = text(1, 'd1', 'Master Direction on KYC', { desk_feature: 'Regulatory Body Watch (RBI SEBI TRAI CCI)', publisher: 'Reserve Bank of India' });
    const html = renderToStaticMarkup(<SourceList lang="hi" sources={[source]} />);
    expect(html).toContain('<span class="ai-source-publisher">प्रकाशक: Reserve Bank of India</span>');
    expect(html).toContain('title="Master Direction on KYC — Regulatory Body Watch (RBI SEBI TRAI CCI) · Published by Reserve Bank of India"');
    expect(html).not.toContain('प्रकाशक: Reserve Bank of India"');
  });
});
