export const PLAN_IDS = ['explorer', 'pro', 'enterprise', 'gov'];

export const PLAN_COLORS = {
  explorer: '#012ea1',
  pro: '#4f1d90',
  enterprise: '#012ea1',
  gov: '#c81322',
};

export const DEFAULT_PLANS = [
  {
    id: 'explorer',
    name: 'EXPLORER',
    who: 'For individuals and researchers',
    monthly: 0,
    yearly: 0,
    unit: '/month',
    tag: 'Explore key dashboards and authoritative data at no cost.',
    cta: 'Get Started Free',
    ctaKind: 'ghost-blue',
    color: PLAN_COLORS.explorer,
    items: [
      'Access to 5 core desks',
      'AI research assistant',
      'Limited data coverage',
      'Up to 3 saved views',
      'Community support',
      'Standard updates',
    ],
  },
  {
    id: 'pro',
    name: 'PROFESSIONAL',
    who: 'For analysts and small teams',
    monthly: 49,
    yearly: 41,
    unit: '/user/month',
    tag: 'Advanced tools and broader coverage for professionals.',
    cta: 'Start 14-Day Free Trial',
    ctaKind: 'fill-purple',
    color: PLAN_COLORS.pro,
    plus: 'Everything in Explorer, plus',
    items: [
      'Access to all desks',
      'Real-time data feeds',
      'Custom dashboards (10)',
      'Advanced search & filters',
      'Email alerts',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'ENTERPRISE',
    who: 'For organizations and departments',
    monthly: 149,
    yearly: 124,
    unit: '/user/month',
    tag: 'Deep intelligence, automation, and collaboration at scale.',
    cta: 'Start 14-Day Free Trial',
    ctaKind: 'fill-blue',
    color: PLAN_COLORS.enterprise,
    popular: true,
    plus: 'Everything in Professional, plus',
    items: [
      'Unlimited dashboards',
      'API access',
      'Team collaboration',
      'Custom data exports',
      'SLA & dedicated support',
      'Audit logs & activity tracking',
    ],
  },
  {
    id: 'gov',
    name: 'GOVERNMENT',
    who: 'For government & public sector',
    custom: true,
    monthly: 0,
    yearly: 0,
    unit: '/year',
    tag: 'Tailored solutions with security, compliance & deployment options.',
    cta: 'Contact Sales',
    ctaKind: 'ghost-red',
    color: PLAN_COLORS.gov,
    plus: 'Everything in Enterprise, plus',
    items: [
      'On-prem or private cloud',
      'Custom integrations',
      'Advanced security controls',
      'Training & onboarding',
      'Dedicated account manager',
      'Uptime & performance SLA',
      'Compliance & governance',
    ],
  },
];

const KEY = 'niyantranPricing';
const EVENT = 'niy-pricing';

function merge(saved) {
  const byId = new Map((Array.isArray(saved) ? saved : []).map((p) => [p.id, p]));
  return DEFAULT_PLANS.map((base) => {
    const extra = byId.get(base.id) || {};
    const items = Array.isArray(extra.items) && extra.items.length ? extra.items : base.items;
    return {
      ...base,
      ...extra,
      id: base.id,
      color: PLAN_COLORS[base.id],
      items,
    };
  });
}

export function loadPricing() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {
    /* keep defaults */
  }
  return merge([]);
}

export function savePricing(plans) {
  localStorage.setItem(KEY, JSON.stringify(plans));
  window.dispatchEvent(new Event(EVENT));
}

export function subscribePricing(fn) {
  const on = () => fn(loadPricing());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}
