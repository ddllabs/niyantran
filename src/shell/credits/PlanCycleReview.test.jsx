import { beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({states:[],cursor:0,effects:[],quote:vi.fn(),state:vi.fn(),schedule:vi.fn(),cancel:vi.fn(),checkout:vi.fn()}));
vi.mock('react',async original=>({...await original(),useState:initial=>{const i=f.cursor++;if(!(i in f.states)) f.states[i]=typeof initial==='function'?initial():initial;return [f.states[i],v=>{f.states[i]=typeof v==='function'?v(f.states[i]):v;}];},useEffect:effect=>f.effects.push(effect),useRef:()=>({current:false})}));
vi.mock('../../lib/billing.js',()=>({fetchPlanQuote:(...a)=>f.quote(...a),fetchPlanState:(...a)=>f.state(...a),scheduleNextPlan:(...a)=>f.schedule(...a),cancelNextPlan:(...a)=>f.cancel(...a),completeCheckout:(...a)=>f.checkout(...a),formatInr:n=>`₹${n.toFixed(2)}`}));
import PlanCycleReview from './PlanCycleReview.jsx';
const ent={plan:'pro',status:'active',periodEnd:new Date(Date.now()+3*86400000).toISOString()};
const user={id:'fixture',email:'fixture@example.test'};
const updated=vi.fn();
const render=(props={})=>{f.cursor=0;return PlanCycleReview({ent,user,onUpdated:updated,...props});};
function all(n,p,out=[]) {if(!n||typeof n!=='object')return out;if(typeof n.type==='function')return all(n.type(n.props),p,out);if(p(n))out.push(n);for(const c of [n.props?.children].flat(Infinity))all(c,p,out);return out;}
function text(n){if(n==null||typeof n==='boolean')return '';if(typeof n==='string'||typeof n==='number')return String(n);return [n?.props?.children].flat(Infinity).map(text).join('');}
beforeEach(()=>{f.states=[];f.cursor=0;f.effects=[];vi.clearAllMocks();f.schedule.mockResolvedValue({ok:true});f.cancel.mockResolvedValue({ok:true});f.state.mockResolvedValue({ok:true});f.quote.mockResolvedValue({ok:true,quote:{}});});
it('schedules a downgrade for zero without Checkout or an invoice',async()=>{
 f.states=['plus',null,{ok:true},false,'',null,0];const tree=render();
 const button=all(tree,n=>n.type==='button'&&text(n).includes('Schedule change'))[0];
 expect(text(tree)).toContain('Due today');expect(text(tree)).toContain('₹0.00');await button.props.onClick();
 expect(f.schedule).toHaveBeenCalledWith('plus');expect(f.checkout).not.toHaveBeenCalled();expect(updated).toHaveBeenCalled();
});
it('pays only the displayed server quote and binds its id',async()=>{
 f.states=['max',{quoteId:'quote-fixture',action:'upgrade',credits:342500,amountPaise:450000,fraction:.5,cycleEndsAt:ent.periodEnd,monthlyCredits:750000,monthlyAmountPaise:999900,expiresAt:new Date(Date.now()+60000).toISOString()},null,false,'',null,0];
 f.checkout.mockResolvedValue({ok:true});const tree=render();
 expect(text(tree)).toContain('₹4500.00');expect(text(tree)).toContain('3,42,500');expect(text(tree)).toContain('existing credits and cycle end stay unchanged');
 await all(tree,n=>n.type==='button'&&text(n).startsWith('Pay '))[0].props.onClick();
 expect(f.checkout).toHaveBeenCalledWith({planId:'max',quoteId:'quote-fixture',user});
});
it('shows an unpaid preference and cancellation without implying paid activation',async()=>{
 f.states=[null,null,{scheduled:{planId:'plus',effectiveAt:ent.periodEnd}},false,'',null,0];const tree=render();
 expect(text(tree)).toContain('unpaid selection');expect(text(tree)).toContain('otherwise your account returns to Free');
 await all(tree,n=>n.type==='button'&&text(n)==='Cancel next selection')[0].props.onClick();expect(f.cancel).toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
});
it('offers explicit manual next-month review without charging immediately',()=>{
 f.states=[null,null,{scheduled:{planId:'plus',effectiveAt:ent.periodEnd}},false,'',null,0];const tree=render();
 all(tree,n=>n.type==='button'&&text(n)==='Review next month')[0].props.onClick();
 expect(f.states[0]).toBe('plus');expect(f.states[5]).toBe('renew');expect(f.checkout).not.toHaveBeenCalled();
});
it('has no pay action before an authoritative quote and disables expired quotes',()=>{
 f.states=['max',null,null,false,'',null,0];expect(all(render(),n=>n.type==='button'&&text(n).startsWith('Pay '))).toHaveLength(0);
 f.states[1]={quoteId:'old',action:'upgrade',credits:1,amountPaise:100,cycleEndsAt:ent.periodEnd,expiresAt:new Date(Date.now()-1000).toISOString()};
 expect(all(render(),n=>n.type==='button'&&text(n).startsWith('Pay '))[0].props.disabled).toBe(true);
});

it('does not quote the current plan before its renewal window',async()=>{
 f.states=['pro',null,{ok:true},false,'',null,0];
 const tree=render({ent:{...ent,periodEnd:new Date(Date.now()+20*86400000).toISOString()}});
 for(const effect of f.effects)effect();await Promise.resolve();
 expect(f.quote).not.toHaveBeenCalled();expect(text(tree)).toContain("You're on Pro");
 expect(all(tree,n=>n.props?.['aria-label']==='Review your purchase')).toHaveLength(0);
});
it('shows the already-saved choice once without a duplicate downgrade confirmation',()=>{
 f.states=['plus',null,{scheduled:{planId:'plus',effectiveAt:ent.periodEnd}},false,'',null,0];const tree=render();
 expect(all(tree,n=>n.props?.['aria-label']==='Next plan selection')).toHaveLength(1);
 expect(all(tree,n=>n.props?.['aria-label']==='Review plan change')).toHaveLength(0);
 expect(f.schedule).not.toHaveBeenCalled();
});
it('shows loading rather than a generic empty purchase form',()=>{
 f.states=['max',null,null,false,'',null,0,'loading'];const tree=render();
 expect(text(tree)).toContain('Getting your price');
 expect(text(tree)).not.toContain('Request a current server quote');
 expect(all(tree,n=>n.type==='button'&&text(n).includes('Refresh quote'))).toHaveLength(0);
});
it('gives an actionable quote error without hiding the server reason',()=>{
 f.states=['max',null,null,false,'Please review again',null,0,'error'];const tree=render();
 expect(text(tree)).toContain('Please review again');
 expect(all(tree,n=>n.type==='button'&&text(n)==='Try quote again')).toHaveLength(1);
 expect(all(tree,n=>n.type==='button'&&text(n).startsWith('Pay '))).toHaveLength(0);
});

it('keeps Free as an explicit two-step future change without a payment',async()=>{
 f.states=[null,null,{ok:true},false,'',null,0];let tree=render();
 all(tree,n=>n.type==='button'&&text(n).includes('No monthly credit allowance'))[0].props.onClick();
 expect(f.schedule).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
 tree=render();expect(text(tree)).toContain('Move to Free');expect(text(tree)).toContain('₹0.00');
 await all(tree,n=>n.type==='button'&&text(n)==='Schedule change to Free')[0].props.onClick();
 expect(f.schedule).toHaveBeenCalledWith('free');expect(f.checkout).not.toHaveBeenCalled();
});

it('accepts a paid account Free deep link as a schedule review only',()=>{
 const tree=render({initialPlan:'free'});expect(text(tree)).toContain('Move to Free');expect(text(tree)).toContain('₹0.00');expect(f.checkout).not.toHaveBeenCalled();
});
it('does not preselect a Free schedule for an existing Free account',()=>{
 const tree=render({initialPlan:'free',ent:{plan:'free',status:'free'}});expect(text(tree)).not.toContain('Move to Free');expect(f.quote).not.toHaveBeenCalled();
});

it('distinguishes early payment availability from the next service period', () => {
 f.states=['pro',null,{ok:true},false,'',null,0];
 const tree=render({ent:{...ent,periodEnd:new Date(Date.now()+20*86400000).toISOString()}});
 expect(text(tree)).toContain('Renew from');
 expect(text(tree)).toContain('Your next month starts');
 expect(text(tree)).toContain('returns to Free');
});
it('keeps the exact quoted total next to a provider-neutral payment action', () => {
 f.states=['max',{quoteId:'quote-exact',action:'upgrade',credits:123,amountPaise:59974,cycleEndsAt:ent.periodEnd,expiresAt:new Date(Date.now()+60000).toISOString()},null,false,'',null,0];
 const tree=render();
 expect(text(tree)).toContain('₹599.74');
 expect(all(tree,n=>n.type==='button'&&text(n)==='Pay online')).toHaveLength(1);
});

it('quotes a lower paid plan as renewal during grace rather than saving a downgrade',async()=>{
 f.states=['plus',null,{ok:true},false,'',null,0];const tree=render({ent:{...ent,inGrace:true,periodEnd:new Date(Date.now()-1000).toISOString()}});
 expect(text(tree)).not.toContain('Save this choice now');
 for(const effect of f.effects)effect();await Promise.resolve();
 expect(f.quote).toHaveBeenCalledWith('plus',null);expect(f.schedule).not.toHaveBeenCalled();
});
it('reviews Free during grace as an immediate end to paid access',async()=>{
 f.states=['free',null,{ok:true},false,'',null,0];const tree=render({ent:{...ent,inGrace:true}});
 expect(text(tree)).toContain('Move to Free now');expect(text(tree)).not.toContain('stays active');
 await all(tree,n=>n.type==='button'&&text(n)==='Switch to Free now')[0].props.onClick();
 expect(f.schedule).toHaveBeenCalledWith('free');expect(f.checkout).not.toHaveBeenCalled();
});

it('keeps the full server price and original renewal anchor visible during grace',()=>{
 f.states=['plus',{quoteId:'grace-quote',action:'renew',credits:20000,amountPaise:39900,monthlyAmountPaise:39900,monthlyCredits:20000,cycleStartsAt:'2026-10-21T12:00:00Z',cycleEndsAt:'2026-11-21T12:00:00Z',expiresAt:new Date(Date.now()+60000).toISOString()},null,false,'',null,0];
 const tree=render({ent:{...ent,inGrace:true,periodEnd:new Date(Date.now()-1000).toISOString()}});
 expect(text(tree)).toContain('₹399.00');expect(text(tree)).toContain('20,000');
 expect(text(tree)).toContain('original paid expiry');expect(text(tree)).toContain('does not start a new month from today');
 expect(text(tree)).not.toContain('Save this choice');expect(text(tree)).not.toContain('Upgrade now');
});

it('describes possible grace before expiry without needing a grace deadline',()=>{
 f.states=['pro',null,{ok:true},false,'',null,0];
 const tree=render({ent:{...ent,graceUntil:null,periodEnd:new Date(Date.now()+20*86400000).toISOString()}});
 expect(text(tree)).toContain('Unless you choose Free, eligible paid model access may continue for up to 48 hours');
 expect(text(tree)).toContain('no new monthly credits');
 expect(text(tree)).not.toContain('returns to Free when this period ends');
});
it('does not promise Free at paid expiry for an unpaid lower selection',()=>{
 f.states=[null,null,{scheduled:{planId:'plus',effectiveAt:ent.periodEnd}},false,'',null,0];
 const tree=render({ent:{...ent,graceUntil:null}});
 expect(text(tree)).toContain('Unless you choose Free, eligible paid model access may continue for up to 48 hours');
 expect(text(tree)).not.toContain('returns to Free at expiry');
});
it('shows an effective Free selection as applied without an impossible cancellation',()=>{
 f.states=[null,null,{scheduled:{planId:'free',effectiveAt:new Date(Date.now()-1000).toISOString()}},false,'',null,0];
 const tree=render({ent:{plan:'free',status:'free'}});
 expect(text(tree)).toContain('Free applied');expect(text(tree)).toContain('Your account is now Free');
 expect(text(tree)).not.toContain('access continues until');
 expect(all(tree,n=>n.type==='button'&&text(n)==='Cancel next selection')).toHaveLength(0);
 expect(f.cancel).not.toHaveBeenCalled();
});
