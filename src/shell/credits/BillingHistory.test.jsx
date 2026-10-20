import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../lib/billing.js',()=>({formatInr:n=>`INR ${n.toFixed(2)}`,openInvoice:vi.fn(),fetchPurchases:vi.fn()}));
import { BillingHistoryTable } from './BillingHistory.jsx';
const order={id:'internal-private-reference',provider_order_id:'order_fixture',state:'fulfilled',created_at:'2026-10-20T15:00:00Z',snapshot:{planId:'pro',action:'upgrade',amountPaise:59974,label:'Pro upgrade'}};
it('joins invoice to one purchase row and collapses its internal reference',()=>{
 const html=renderToStaticMarkup(<BillingHistoryTable orders={[order]} invoices={[{id:'inv_fixture',orderId:'order_fixture',invoiceNo:'NIY/2627/00009',total:599.74}]}/>);
 expect(html).toContain('Upgrade to Pro');expect(html).toContain('599.74');expect(html).toContain('View invoice');
 expect(html).toMatch(/<details[^>]*>.*internal-private-reference/s);expect(html).not.toMatch(/<details[^>]*open/);
 expect(html.match(/NIY\/2627\/00009/g)).toHaveLength(1);
});
it('hides abandoned checkouts but preserves warnings for uncertain payment',()=>{
 const html=renderToStaticMarkup(<BillingHistoryTable orders={[{...order,state:'ready',id:'abandoned'},{...order,state:'review',id:'uncertain'}]} invoices={[]}/>);
 expect(html).not.toContain('abandoned');expect(html).toContain('Support review');expect(html).toContain('Check before paying again');
});
it('keeps an invoice when an older purchase has no order-list row',()=>{
 const html=renderToStaticMarkup(<BillingHistoryTable orders={[]} invoices={[{id:'inv_old',invoiceNo:'NIY/2627/00001',total:399,description:'Plus plan',issuedAt:'2026-10-20'}]}/>);
 expect(html).toContain('Plus plan');expect(html).toContain('NIY/2627/00001');
});
