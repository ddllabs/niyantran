import { expect, it } from 'vitest';
import { manualRenewalNotice, billingDateTime } from './manualRenewalNotice.js';
const end='2026-10-21T12:00:00Z';
const paid={plan:'pro',status:'active',periodEnd:end,graceUntil:'2026-10-23T12:00:00Z'};
it('uses exact seven and two day reminder windows without inferring grace',()=>{
 expect(manualRenewalNotice(paid,Date.parse(end)-7*86400000-1)).toBeNull();
 expect(manualRenewalNotice(paid,Date.parse(end)-7*86400000).kind).toBe('reminder');
 expect(manualRenewalNotice(paid,Date.parse(end)-2*86400000).kind).toBe('due-soon');
 expect(manualRenewalNotice(paid,Date.parse(end)+1)).toBeNull();
});
it('requires authoritative paid grace and returns Free recovery after lapse',()=>{
 expect(manualRenewalNotice({...paid,inGrace:true}).kind).toBe('grace');
 expect(manualRenewalNotice({plan:'free',status:'free',lapsed:true,periodEnd:end}).kind).toBe('lapsed');
 expect(manualRenewalNotice({plan:'free',status:'free'})).toBeNull();
 expect(manualRenewalNotice({...paid,periodEnd:'invalid'})).toBeNull();
});
it('formats the deadline in IST with its exact time',()=>expect(billingDateTime(end)).toBe('21 Oct 2026, 5:30 pm IST'));
