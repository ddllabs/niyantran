import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RecordFocus from './RecordFocus.jsx';
it('distinguishes a missing record from its retained search results',()=>{
 const html=renderToStaticMarkup(<RecordFocus focus={{row:null}} feature="Bills" onReturn={()=>{}}/>);
 expect(html).toContain('Record unavailable'); expect(html).toContain('Return to results');
});
it('renders current scalar fields safely and avoids internal or nested row metadata',()=>{
 const html=renderToStaticMarkup(<RecordFocus focus={{row:{title:'<script>bad</script>',_secret:'internal',other:{nested:'object'}}}} feature="Bills" onReturn={()=>{}}/>);
 expect(html).not.toContain('<script>'); expect(html).not.toContain('internal'); expect(html).not.toContain('nested');
 expect(html).toContain('&lt;script&gt;');
});
