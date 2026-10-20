import { expect,it } from 'vitest';
import { renderInvoiceHtml } from '../../server/inrBilling.mjs';
const invoice={invoiceNo:'NIY/2627/00009',total:599.74,planId:'pro',issuedAt:'2026-10-20T16:31:00Z',buyerName:'Test Buyer',email:'fixture@example.test',description:'Upgrade to Pro',provider:'razorpay',paymentId:'pay_fixture',cycleEndsAt:'2026-11-20T16:13:00Z',action:'upgrade'};
it('embeds the actual company mark and exact payment facts without external image requests',()=>{
 const html=renderInvoiceHtml(invoice);expect(html).toContain('data:image/webp;base64,');expect(html).toContain('Niyantran');expect(html).toContain('₹599.74');expect(html).toContain('20 Nov 2026');expect(html).toContain('pay_fixture');expect(html).toContain('Print / Save PDF');
});
it('escapes buyer/seller/description text in the branded template',()=>{
 const html=renderInvoiceHtml({...invoice,buyerName:'<script>bad()</script>',description:'<img onerror="bad">',seller:{legalName:'<bad>',tradeName:'Terminal',address:'Address',email:'fixture@example.test'}});
 expect(html).not.toContain('<script>bad');expect(html).not.toContain('<img onerror');expect(html).toContain('&lt;script&gt;');
});
it('still renders historical invoices without cycle metadata',()=>{const html=renderInvoiceHtml({invoiceNo:'NIY/2627/00001',total:399,planId:'plus'});expect(html).toContain('₹399.00');expect(html).not.toContain('Invalid Date');});
