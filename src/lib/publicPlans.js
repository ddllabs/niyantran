// Public pricing page content (owner plans, 2026-10-12). Plans differ only in AI
// credits (and personal storage once it exists). This is display data only:
// billing still uses pricingStore/billing.js until open-work F109 aligns it.
// `tone` reuses the existing card and table colour slots.

export const PUBLIC_PLANS = [
  {
    id: 'free', tone: 'explorer', name: 'FREE', monthly: 0, unit: '/month',
    who: 'For everyone getting started',
    tag: 'Every desk and the AI research assistant at no cost.',
    cta: 'Get started free', ctaKind: 'ghost-blue',
    items: ['All 8 desks and 120 modules', 'AI research assistant with starter credits', 'Cited answers with the source document', 'Copy and export'],
  },
  {
    id: 'plus', tone: 'pro', name: 'PLUS', monthly: 399, unit: '/month',
    who: 'For regular research',
    tag: 'More AI credits for everyday questions.',
    cta: 'Get started', ctaKind: 'fill-purple', plus: 'Everything in Free, plus',
    items: ['More monthly AI credits', 'Unused credits carry forward'],
  },
  {
    id: 'pro', tone: 'enterprise', name: 'PRO', monthly: 999, unit: '/month', popular: true,
    who: 'For analysts and professionals',
    tag: 'Higher AI credits and our own research model.',
    cta: 'Get started', ctaKind: 'fill-blue', plus: 'Everything in Plus, plus',
    items: ['Higher monthly AI credits', 'Niyantran AI is coming soon', 'Unused credits carry forward'],
  },
  {
    id: 'max', tone: 'gov', name: 'MAX', monthly: 9999, unit: '/month',
    who: 'For heavy research use',
    tag: 'The largest AI credit allowance.',
    cta: 'Get started', ctaKind: 'ghost-red', plus: 'Everything in Pro, plus',
    items: ['Highest monthly AI credits', 'Niyantran AI is coming soon', 'Unused credits carry forward'],
  },
];

export const rupees = amount => `₹${amount.toLocaleString('en-IN')}`;

export const PRICING_COMPARE = [
  ['Desks and modules', 'All 8 desks', 'All 8 desks', 'All 8 desks', 'All 8 desks'],
  ['AI research assistant', true, true, true, true],
  ['Cited answers and source viewer', true, true, true, true],
  ['Copy and export', true, true, true, true],
  ['Monthly AI credits', 'Starter', 'More', 'Higher', 'Highest'],
  ['Unused credits carry forward', true, true, true, true],
  ['Niyantran AI model', false, false, 'Coming soon', 'Coming soon'],
  ['Personal file storage', 'Coming later', 'Coming later', 'Coming later', 'Coming later'],
  ['Price per month', ...PUBLIC_PLANS.map(p => rupees(p.monthly))],
];

export const PRICING_NOTES = [
  'Plans are billed monthly in Indian rupees. We are not registered under GST, so no GST is charged: the price shown is the price you pay.',
  'Each plan’s AI credit allowance will be published with our credit policy before paid plans open for purchase.',
];
