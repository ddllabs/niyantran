import { expect,it,vi } from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('../../lib/billing.js',()=>({formatInr:n=>`INR ${n}`,fetchPlanState:vi.fn(),fetchPlanQuote:vi.fn(),fetchPurchases:vi.fn(),fetchPlanPeriods:vi.fn(),fetchBillingConfig:vi.fn(),fetchBillingReviews:vi.fn(),openInvoice:vi.fn(),cancelNextPlan:vi.fn(),completeCheckout:vi.fn(),scheduleNextPlan:vi.fn(),reviewBillingAdjustment:vi.fn(),runBillingRecovery:vi.fn()}));
import BillingWorkspace from './BillingWorkspace.jsx';
const props={ent:{plan:'pro',status:'active',periodEnd:'2026-11-20'},user:{id:'fixture',role:'user'},config:{enabled:true},credits:{balance:1000,available:900,held:100,debt:20,allowance:64980,usedThisCycle:10,lots:[{kind:'topup',remaining:1000,expiresAt:'2027-10-20'}]},invoices:[],revision:0};
it('preserves held/debt and expiry facts while showing spendable balance',()=>{const html=renderToStaticMarkup(<BillingWorkspace {...props}/>);expect(html).toContain('900 credits');expect(html).toContain('100 credits');expect(html).toContain('20 credits');expect(html).toContain('Credit breakdown');expect(html).toContain('20 Oct 2027');expect(html).not.toContain('Payment operations');});
it('shows Free and welcome credits rather than a nonexistent paid period',()=>{const html=renderToStaticMarkup(<BillingWorkspace {...props} ent={{plan:'free',status:'free'}} credits={{...props.credits,lots:[{kind:'signup',remaining:1234}]}}/>);expect(html).toContain('Sign-up');expect(html).toContain('No monthly allowance');expect(html).toContain('1,234 credits');expect(html).not.toContain('Active until');expect(html).not.toContain('Renew manually before expiry');});

it('separates the full monthly allowance from the actual period allocation and available credits',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props}/>);
 const summary=html.match(/<dl class="billing-account-facts">([\s\S]*?)<\/dl>/)[1];
 expect(summary.match(/<dt>/g)).toHaveLength(3);
 expect(summary).toContain('Plan price');expect(summary).toContain('Monthly allowance');expect(summary).toContain('65,000 credits');expect(summary).toContain('Credits available');
 expect(summary).not.toContain('64,980');expect(summary).not.toContain('Top-up balance');
 expect(html).toContain('Plan credits added this period:');expect(html).toContain('64,980 credits');expect(html).toContain('prorated upgrade');
});

it('shows the standard allowance even when the personal credit read is unavailable',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} credits={null} creditsTried/>);
 expect(html).toContain('65,000 credits');expect(html).toContain('Your balance could not be loaded');expect(html).not.toContain('Plan credits added this period');
});
it('keeps the chooser visible by default without an open or close toggle',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} initialPlan={null}/>);
 expect(html).toContain('Choose your plan');
 expect(html).not.toMatch(/id="billing-plan-picker"[^>]*hidden/);
 expect(html).not.toContain('Close plan options');expect(html).not.toContain('>Change plan<');
 expect(html).not.toContain('10% monthly rollover');
});

it('reserves a native credit disclosure while the balance is loading',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} credits={null}/>);
 expect(html).toContain('class="billing-credit-details"');
 expect(html).toContain('Credit breakdown &amp; expiry');
 expect(html).toContain('Loading your credit breakdown');
});

it('keeps billing child reads unmounted until configuration is known',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} config={null}/>);
 expect(html).toContain('Loading plan options');
 expect(html).not.toContain('Billing history');
 expect(html).not.toContain('Available plans');
});
it('shows a retryable configuration error instead of legacy checkout',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} config={{unavailable:true}}/>);
 expect(html).toContain('Billing options could not be loaded');
 expect(html).toContain('Try again');
 expect(html).not.toContain('Available plans');
});

it('shows access-only grace once without presenting a new monthly allocation',()=>{
 const html=renderToStaticMarkup(<BillingWorkspace {...props} ent={{...props.ent,inGrace:true,periodEnd:'2026-10-21T12:00:00Z',graceUntil:'2026-10-23T12:00:00Z',accessUntil:'2026-10-23T12:00:00Z'}}/>);
 expect(html).toContain('Renew now');expect(html).toContain('23 Oct 2026, 5:30 pm IST');
 expect(html).toContain('No new monthly credits');expect(html).toContain('original monthly anchor');
 expect(html).not.toContain('Plan credits added this period');expect(html).not.toContain('Active until');
 expect(html.match(/aria-label="Manual renewal notice"/g)).toHaveLength(1);
});
