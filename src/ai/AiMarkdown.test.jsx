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
