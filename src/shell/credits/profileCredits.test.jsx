import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({ credits: null }));
vi.mock('../../lib/creditsStore.js', async (original) => ({ ...(await original()), serverCredits: () => data.credits }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {} }));
import ProfileCredits, { CreditGlanceBody } from './BalancePill.jsx';

const wallet = { userId: 'u1', balance: 3304, held: 4, plan: 'free', allowance: 10000, usedThisCycle: 6696, cycleEndsAt: '2099-11-10T00:00:00Z', lots: [{ kind: 'signup', remaining: 3304 }] };
const user = { id: 'u1', name: 'Vighnesh' };
beforeEach(() => { data.credits = wallet; });
const render = (open) => renderToStaticMarkup(<ProfileCredits user={user} open={open} setOpen={vi.fn()}>{(glance) => <><strong>Account identity</strong>{glance}<button className="profile-pop-upgrade">Credits</button></>}</ProfileCredits>);

it('uses the profile initial and balance ring as one accessible header control', () => {
  const html = render(false);
  expect(html).toContain('avatar-btn');
  expect(html).toContain('cp-profile-ring');
  expect(html).toContain('>V</span>');
  expect(html).toContain('3,300 credits left.');
  expect(html).not.toContain('cp-pill-text');
  expect(html).not.toContain('role="dialog"');
});

it('embeds all existing summary sections inside one Account dialog', () => {
  const html = render(true);
  expect(html.match(/role="dialog"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Account"');
  expect(html).toContain('Account identity');
  expect(html).toContain('cp-profile-summary');
  expect(html).toContain('3,300');
  expect(html).toContain('until they expire');
  expect(html).toContain('4 held for a running answer');
  expect(html).toContain('>Credits</button>');
  expect(html).not.toContain('Open credits page');
});

it('retains the period breakdown, pace estimate and latest charges in the embedded summary', () => {
  const html = renderToStaticMarkup(<CreditGlanceBody credits={wallet} extra={{ pace: { tone: 'warn', text: 'At this pace you would run out around 21 Oct.' }, latest: [{ turnKey: 'a', question: 'First question', credits: 5.06 }, { turnKey: 'b', question: 'Second question', credits: 182 }] }} onClose={vi.fn()} />);
  for (const text of ['cp-bar', 'At this pace', 'Latest', 'First question', 'Second question', '5.06', '182']) expect(html).toContain(text);
  expect(html).not.toContain('role="dialog"');
});

it('keeps unknown balance and warning details in the combined dropdown', () => {
  data.credits = null;
  const html = render(true);
  expect(html).toContain('Loading your credits…');
  expect(html).toContain('cp-ring-loading');
  expect(html).not.toContain('3,300');
});
