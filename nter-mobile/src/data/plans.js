// Plans and prices as nter.pro publishes them (src/lib/publicPlans.js on the website).
export const PLANS = [
  { id: 'free', name: 'Free', monthly: 0, credits: 0, line: '10,000 AI credits to start, valid 30 days · all 8 desks · fast models' },
  { id: 'plus', name: 'Plus', monthly: 399, credits: 20000, line: '20,000 credits every month · every model incl. Claude Sonnet, Opus and GPT Astra' },
  { id: 'pro', name: 'Pro', monthly: 999, credits: 65000, line: '65,000 credits every month · every model · Niyantran AI coming soon', popular: true },
  { id: 'max', name: 'Max', monthly: 9999, credits: 750000, line: '750,000 credits every month for heavy research use' },
];
export const PLAN_RANK = { free: 0, plus: 1, pro: 2, max: 3 };
export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
export const planName = (id) => PLANS.find((p) => p.id === id)?.name || 'Free';
