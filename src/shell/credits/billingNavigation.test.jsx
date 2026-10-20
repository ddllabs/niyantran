import { expect,it,vi } from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SECTION_PARTS, jumpToPart} from './CreditsPage.jsx';
import BillingWorkspace from './BillingWorkspace.jsx';
it('every billing subsection targets an actual current heading',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace ent={{plan:'free',status:'free'}} user={{id:'fixture'}} config={{enabled:false}} credits={null} invoices={[]} revision={0}/>);
 for(const [id] of SECTION_PARTS.billing) expect(html).toContain(`id="${id}"`);
});
it('scrolls the page to modern or legacy headings with reduced-motion support',()=>{
 const el={getBoundingClientRect:()=>({top:400})};
 const page={scrollTop:100,getBoundingClientRect:()=>({top:50}),scrollTo:vi.fn()};
 const win={matchMedia:()=>({matches:true})};
 jumpToPart(page,'billing-current-title',{getElementById:id=>id==='billing-current-title'?el:null},win);
 expect(page.scrollTo).toHaveBeenLastCalledWith({top:438,behavior:'auto'});
 page.scrollTo.mockClear();
 jumpToPart(page,'billing-history-title',{getElementById:id=>id==='plan-invoices-title'?el:null},win);
 expect(page.scrollTo).toHaveBeenLastCalledWith({top:438,behavior:'auto'});
});
