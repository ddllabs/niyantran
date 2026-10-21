import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BillingCreditBreakdown from './BillingCreditBreakdown.jsx';

it('groups only matching type and exact expiry while retaining original grants and input', () => {
  const lots = [
    { kind:'monthly', remaining:20000, expiresAt:'2026-11-20T12:00:00Z' },
    { kind:'monthly', remaining:44980, expiresAt:'2026-11-20T12:00:00Z' },
    { kind:'monthly', remaining:7, expiresAt:'2026-11-20T13:00:00Z' },
    { kind:'topup', remaining:20000, expiresAt:'2026-11-20T12:00:00Z' },
    { kind:'signup', remaining:1186, expiresAt:'2026-11-13T12:00:00Z' },
  ];
  const original=structuredClone(lots);
  const html=renderToStaticMarkup(<BillingCreditBreakdown lots={lots}/>);
  expect(html).toContain('64,980 credits');
  expect(html).toContain('Grant 1: 20,000 credits');
  expect(html).toContain('Grant 2: 44,980 credits');
  expect(html.match(/scope="row"/g)).toHaveLength(4);
  expect(html.indexOf('Sign-up')).toBeLessThan(html.indexOf('Monthly'));
  expect(lots).toEqual(original);
});
it('keeps no-expiry and empty states readable',()=>{
 expect(renderToStaticMarkup(<BillingCreditBreakdown lots={[{kind:'adjustment',remaining:2}]}/>)).toContain('No expiry');
 expect(renderToStaticMarkup(<BillingCreditBreakdown/>)).toContain('no credits right now');
});
