import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import AiMarkdown from './AiMarkdown.jsx';
const source={id:1,kind:'text',chunk_id:'c',document_id:'d',title:'Evidence',char_from:0,char_to:5,text_hash:'h',source_kind:'document'};
it('renders safe break tokens in table cells without enabling HTML or changing code literals',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'| Fact | Evidence |\n|---|---|\n| First<br>Second<BR />Third | **One<br/>Two** [1] `<br>` <img src=x onerror=alert(1)> |'} sources={[source]}/>);
 expect(html).toContain('<td>First<br/>Second<br/>Third</td>');
 expect(html).toContain('<strong>One<br/>Two</strong>');
 expect(html).toContain('<code>&lt;br&gt;</code>');
 expect(html).not.toContain('<img');
 expect(html).toContain('cite-bubble');
});
it('resolved research markers become source buttons in paragraphs, headings and lists',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'# Finding [1]\n\nEvidence **supports** this [1].\n\n- Item [1]'} sources={[source]}/>);
 expect(html.match(/cite-bubble/g)).toHaveLength(3);expect(html).toContain('<strong>supports</strong>');expect(html).not.toContain('[1]');
});
it('malformed sources stay unresolved and placeholders exist only while streaming',()=>{
 const bad={...source,document_id:''};
 const live=renderToStaticMarkup(<AiMarkdown text="Pending [1]." sources={[bad]} streaming/>);
 expect(live).toContain('placeholder');expect(live).not.toContain('<button');
 const saved=renderToStaticMarkup(<AiMarkdown text="Pending [1]." sources={[bad]}/>);
 expect(saved).not.toContain('placeholder');expect(saved).not.toContain('[1]');expect(saved).not.toContain('<button');
});
it('legacy rendering leaves literal bracket references and formatting unchanged',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'See clause [3] and **bold** or `code`.\n\n[Source](https://example.invalid/doc)'}/>);
 expect(html).toContain('clause [3]');expect(html).toContain('<strong>bold</strong>');expect(html).toContain('<code>code</code>');expect(html).toContain('href="https://example.invalid/doc"');expect(html).not.toContain('cite-bubble');
});

// The block grammar the UPSC persona writes in, and that answers already used:
// every case below rendered wrongly before - a table as one line of pipes, a
// nested bullet as garbled italics, "1. 2. 3." as "1. 1. 1.", and any run of
// one-statement lines as a single sentence.
it('a pipe table renders as a table, with citation bubbles and emphasis inside its cells',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'| Slot | Fact |\n|---|---|\n| Legal status | **Act No. 39 of 2007** [1] |\n| Nodal body | CCI |'} sources={[source]}/>);
 expect(html).toContain('<table>');expect(html).toContain('<th>Slot</th>');expect(html).toContain('<td>CCI</td>');
 expect(html).toContain('<strong>Act No. 39 of 2007</strong>');expect(html).toMatch(/<td>.*cite-bubble.*<\/td>/);
 expect(html).not.toContain('|---|');expect(html).not.toContain('| Slot');
});
it('a table without a rule row has no header, and a wide one scrolls rather than squeezes',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'| a | b |\n| c | d |'}/>);
 expect(html).not.toContain('<thead>');expect(html.match(/<tr>/g)).toHaveLength(2);expect(html).toContain('class="ai-md-table"');
});
it('an indented bullet nests under its item and keeps its bold, instead of turning into italics',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'1. **COMPAT:**\n   * Inserted **Section 53A**\n   * Redefined the **CCI**\n2. **Combinations:**\n   - Made **mandatory**'}/>);
 expect(html).toContain('<ol><li><strong>COMPAT:</strong><ul><li>Inserted <strong>Section 53A</strong></li>');
 expect(html).not.toContain('<em>');expect(html.match(/<ol/g)).toHaveLength(1);
});
it('numbered items separated by blank lines stay one list, and a resumed list keeps its number',()=>{
 const one=renderToStaticMarkup(<AiMarkdown text={'1. First\n\n2. Second\n\n3. Third'}/>);
 expect(one.match(/<ol/g)).toHaveLength(1);expect(one.match(/<li>/g)).toHaveLength(3);
 const resumed=renderToStaticMarkup(<AiMarkdown text={'1. First\n\n| a | b |\n|---|---|\n| c | d |\n\n2. Second'}/>);
 expect(resumed).toContain('<ol start="2">');
});
it('lines written one statement per line stay on their own lines',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'**TIMELINE** Competition law\n2002 Competition Act\n2007 Amendment Act'}/>);
 expect(html).toContain('Competition law<br/>2002 Competition Act<br/>2007 Amendment Act');
 const traps=renderToStaticMarkup(<AiMarkdown text={'**MCQ TRAP CHECK**\n"COMPAT was set up in 2002" — ✗ (2007)\n"Notification is mandatory" — ✓'}/>);
 expect(traps.match(/<br\/>/g)).toHaveLength(2);
});
it('headings go to h6 and quotes render as quotes',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'# One\n## Two\n### Three\n#### Four\n\n> A quoted line\n> and its next line'}/>);
 expect(html).toContain('<h3>One</h3>');expect(html).toContain('<h5>Three</h5>');expect(html).toContain('<h6>Four</h6>');
 expect(html).toContain('<blockquote>A quoted line<br/>and its next line</blockquote>');expect(html).not.toContain('####');
});
it('an answer that only uses paragraphs and flat bullets renders as it always did',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'Lead sentence with **bold**.\n\n- One\n- Two\n\nClosing line.'}/>);
 expect(html).toBe('<div class="ai-md"><p>Lead sentence with <strong>bold</strong>.</p><ul><li>One</li><li>Two</li></ul><p>Closing line.</p></div>');
});

// F130 T4b: a link to a page the turn searched carries a small globe, so a web citation reads
// differently from a record citation [n]. Every other link renders as it always did.
const WEB = [
 {url:'https://www.rbi.org.in/press?id=1',title:'RBI',domain:'rbi.org.in',cited:true},
 {url:'https://pib.gov.in/x',title:'PIB',domain:'pib.gov.in',cited:false},
];
it('marks a link whose URL is a searched page, with an accessible "web source" label',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text="The repo rate held ([RBI](https://www.rbi.org.in/press?id=1))." sources={[source]} webSources={WEB}/>);
 expect(html).toContain('class="ai-web-link"');
 expect(html).toContain('href="https://www.rbi.org.in/press?id=1"');
 expect(html).toContain('target="_blank"');
 expect(html).toMatch(/aria-label="web source"/);
 expect(html).toContain('<svg');
 expect(html).toContain('>RBI<');
});
it('matches after lower-casing scheme and host and dropping the fragment, and only then',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text="[a](https://WWW.RBI.ORG.IN/press?id=1#section) and [b](https://pib.gov.in/other) and [c](https://www.rbi.org.in/press?id=2) and [d](https://pib.gov.in/Y)" webSources={[...WEB,{url:'HTTPS://PIB.GOV.IN/Y#top',title:'Y',domain:'pib.gov.in',cited:false}]}/>);
 expect(html.match(/class="ai-web-link"/g)).toHaveLength(2);
 expect(html).toContain('>a<');expect(html).toContain('>d<');expect(html).not.toMatch(/>b<span|>c<span/);
});
it('leaves every other link exactly as before, with or without web sources',()=>{
 const text='[Source](https://example.invalid/doc)';
 const before=renderToStaticMarkup(<AiMarkdown text={text}/>);
 expect(renderToStaticMarkup(<AiMarkdown text={text} webSources={WEB}/>)).toBe(before);
 expect(renderToStaticMarkup(<AiMarkdown text={text} webSources={[]}/>)).toBe(before);
 expect(before).not.toContain('ai-web-link');
 expect(before).not.toContain('web source');
});
it('a web link does not touch citation markers, and ignores web sources that are not http(s)',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text="Evidence [1] and [RBI](https://pib.gov.in/x)." sources={[source]} webSources={[...WEB,{url:'javascript:alert(1)',title:'x',domain:'x'},null]}/>);
 expect(html.match(/cite-bubble/g)).toHaveLength(1);
 expect(html.match(/class="ai-web-link"/g)).toHaveLength(1);
 expect(html).not.toContain('javascript:');
 expect(renderToStaticMarkup(<AiMarkdown text="[x](https://pib.gov.in/x)" webSources="nope"/>)).not.toContain('ai-web-link');
});
it('marks web links in table cells and list items as well',()=>{
 const html=renderToStaticMarkup(<AiMarkdown text={'- see [PIB](https://pib.gov.in/x)\n\n| a | b |\n|---|---|\n| c | [RBI](https://www.rbi.org.in/press?id=1) |'} webSources={WEB}/>);
 expect(html.match(/class="ai-web-link"/g)).toHaveLength(2);
});

// Security pass M1 (client half): in the research chat a link is clickable only when its page is
// one this answer may link to - a searched page or a cited document's file. Anything else, and
// anything with a fragment, is its plain text. Without the prop, rendering is unchanged.
it('with allowedLinks, only an allowed link without a fragment is an anchor; the rest is plain text',()=>{
  const allowed=['https://www.rbi.org.in/press','https://sansad.in/bill.pdf'];
  const html=renderToStaticMarkup(<AiMarkdown allowedLinks={allowed} text={'See [RBI](https://WWW.RBI.org.in/press), [bill](https://sansad.in/bill.pdf), [bad](https://evil.example/x) and [frag](https://www.rbi.org.in/press#d=1).'}/>);
  expect(html.match(/<a /g)).toHaveLength(2);
  expect(html).not.toContain('evil.example');
  expect(html).toContain('bad');
  expect(html).not.toContain('#d=1');
  expect(html).toContain('frag');
});
it('with an empty allowedLinks (a streaming answer), no link is clickable; without the prop, links are as before',()=>{
  expect(renderToStaticMarkup(<AiMarkdown allowedLinks={[]} streaming sources={[]} text="[x](https://pib.gov.in/x)"/>)).not.toContain('<a ');
  expect(renderToStaticMarkup(<AiMarkdown text="[x](https://pib.gov.in/x)"/>)).toContain('<a href="https://pib.gov.in/x"');
});
