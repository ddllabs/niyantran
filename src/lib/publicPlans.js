// The plans (owner, 2026-10-12): the one source of plan ids and rupee prices
// for the pricing page, checkout and the billing server (open-work F109).
// Plans differ only in AI credits (and personal storage once it exists).
// `tone` reuses the existing card and table colour slots.

export const PUBLIC_PLANS = [
  {
    id: 'free', tone: 'explorer', name: 'FREE', monthly: 0, unit: '/month',
    who: 'For everyone getting started',
    tag: 'Every desk at no cost, plus 10,000 AI credits to try the research assistant.',
    cta: 'Get started free', ctaKind: 'ghost-blue',
    items: ['All 8 desks and 120 modules', 'AI research assistant', '10,000 AI credits to start, valid 30 days', 'Fast AI models: Gemini Flash, DeepSeek, GPT Luna, Claude Haiku', 'Cited answers with the source document', 'Copy and export'],
  },
  {
    id: 'plus', tone: 'pro', name: 'PLUS', monthly: 399, unit: '/month',
    who: 'For regular research',
    tag: 'More AI credits for everyday questions.',
    cta: 'Get started', ctaKind: 'fill-purple', plus: 'Everything in Free, plus',
    items: ['20,000 AI credits every month', 'Every AI model, including Claude Sonnet and Opus and GPT Astra', '10% of unused credits roll over for a month'],
  },
  {
    id: 'pro', tone: 'enterprise', name: 'PRO', monthly: 999, unit: '/month', popular: true,
    who: 'For analysts and professionals',
    tag: 'Higher AI credits and our own research model.',
    cta: 'Get started', ctaKind: 'fill-blue', plus: 'Everything in Plus, plus',
    items: ['65,000 AI credits every month', 'Every AI model, including Claude Sonnet and Opus and GPT Astra', 'Niyantran AI is coming soon', '10% of unused credits roll over for a month'],
  },
  {
    id: 'max', tone: 'gov', name: 'MAX', monthly: 9999, unit: '/month',
    who: 'For heavy research use',
    tag: 'The largest AI credit allowance.',
    cta: 'Get started', ctaKind: 'ghost-red', plus: 'Everything in Pro, plus',
    items: ['750,000 AI credits every month', 'Every AI model, including Claude Sonnet and Opus and GPT Astra', 'Niyantran AI is coming soon', '10% of unused credits roll over for a month'],
  },
];

export const rupees = amount => `₹${amount.toLocaleString('en-IN')}`;

// Older plan names map to their successors; anything unknown is free.
const LEGACY_PLANS = { explorer: 'free', professional: 'pro', enterprise: 'max' };

export function normalizePlanId(plan) {
  const id = String(plan || 'free').toLowerCase();
  const next = LEGACY_PLANS[id] || id;
  return PUBLIC_PLANS.some(p => p.id === next) ? next : 'free';
}

const PLAN_RANK = { free: 0, plus: 1, pro: 2, max: 3 };

// What buying `target` means for an account (owner, F110): any paid plan from
// Free (or a lapsed month); while a plan is active, the same plan renews and a
// higher one upgrades from now; a lower plan or Free cannot be bought.
export function purchaseKind(entitlement, target) {
  const want = PLAN_RANK[String(target || '').toLowerCase()];
  if (!want) return 'blocked';
  const active = entitlement?.status === 'active' && !entitlement?.lapsed;
  const have = active ? PLAN_RANK[normalizePlanId(entitlement.plan)] : 0;
  if (!have) return 'choose';
  if (want === have) return 'renew';
  return want > have ? 'upgrade' : 'downgrade';
}

export const PRICING_COMPARE = [
  ['Desks and modules', 'All 8 desks', 'All 8 desks', 'All 8 desks', 'All 8 desks'],
  ['AI research assistant', true, true, true, true],
  ['Cited answers and source viewer', true, true, true, true],
  ['Copy and export', true, true, true, true],
  ['Monthly AI credits', '10,000 to start', '20,000', '65,000', '750,000'],
  ['Unused credits roll over', '—', '10% for a month', '10% for a month', '10% for a month'],
  ['Niyantran AI model', false, false, 'Coming soon', 'Coming soon'],
  ['Personal file storage', 'Coming later', 'Coming later', 'Coming later', 'Coming later'],
  ['Price per month', ...PUBLIC_PLANS.map(p => rupees(p.monthly))],
];

// Billing facts shown as chips above the plan cards.
export const PRICING_NOTES = [
  { title: 'Billed monthly in ₹', text: 'cancel any time', tone: 'navy', icon: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16' },
  { title: 'No GST added', text: 'we are not registered under GST', tone: 'sand', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4' },
  { title: 'AI credits', text: 'a typical answer uses about 200 credits; larger models use more', tone: 'purple', icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6' },
];
