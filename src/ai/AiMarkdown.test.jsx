import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import AiMarkdown from './AiMarkdown.jsx';
const source={id:1,kind:'text',chunk_id:'c',document_id:'d',title:'Evidence',char_from:0,char_to:5,text_hash:'h',source_kind:'document'};
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
