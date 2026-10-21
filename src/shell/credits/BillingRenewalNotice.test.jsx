import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BillingRenewalNotice from './BillingRenewalNotice.jsx';
const ent={plan:'pro',status:'active',periodEnd:'2026-10-21T12:00:00Z',graceUntil:'2026-10-23T12:00:00Z',inGrace:true};
it('shows one persistent truthful grace notice and a native renewal action',()=>{
 const html=renderToStaticMarkup(<BillingRenewalNotice ent={ent} onRenew={()=>{}}/>);
 expect(html).toContain('23 Oct 2026, 5:30 pm IST');expect(html).toContain('No new monthly credits');
 expect(html).toContain('Every AI request still uses credits');expect(html).toContain('Renew now');
 expect(html).not.toMatch(/payment failed|AutoPay|automatic debit/i);
});
it('selects the same paid plan for review without making a payment',()=>{
 const renew=vi.fn();const tree=BillingRenewalNotice({ent,onRenew:renew});
 tree.props.children[1].props.onClick();expect(renew).toHaveBeenCalledWith('pro');
});
it('offers plan selection after Free restoration and handles legacy missing grace fields',()=>{
 const html=renderToStaticMarkup(<BillingRenewalNotice ent={{plan:'free',status:'free',lapsed:true,periodEnd:ent.periodEnd}} onRenew={()=>{}}/>);
 expect(html).toContain('Your account is now Free');expect(html).toContain('Choose a paid plan');
 expect(renderToStaticMarkup(<BillingRenewalNotice ent={{plan:'free'}}/>)).toBe('');
});

it('describes eligible grace before expiry even when the current read has no grace deadline',()=>{
 const html=renderToStaticMarkup(<BillingRenewalNotice ent={{...ent,inGrace:false,graceUntil:null}} now={Date.parse(ent.periodEnd)-86400000}/>);
 expect(html).toContain('Unless you choose Free, eligible paid model access may continue for up to 48 hours');
 expect(html).toContain('no new monthly credits');
 expect(html).not.toContain('Paid model access continues until');
});
