// F111 task 4a (docs/specs/2026-10-14-ai-credits.md §8): the balance by the chat box, its warning,
// and the blocked state. Credits only; the rupee hint comes from the server's published rate.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CreditBalance, { OPEN_BILLING_EVENT, openPlanBilling, watchCredits } from './CreditBalance.jsx';

const credits = (patch = {}) => ({
  userId: 'u1', balance: 1520.4567, held: 0, available: 1520.4567, debt: 0, plan: 'plus', inrPerCredit: 0.1,
  allowance: 2000, cycleEndsAt: '2026-11-14T00:00:00Z', lots: [], recent: [], ...patch,
});
const html = (props) => renderToStaticMarkup(<CreditBalance {...props} />);

/** Every element in a hook-free component's output, so a test can press its buttons. */
function elements(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && node.props) {
    out.push(node);
    elements(node.props.children, out);
  }
  return out;
}
const buttonLabelled = (tree, label) => elements(tree).find((e) => e.type === 'button' && [].concat(e.props.children).join('') === label);

describe('the balance by the chat box', () => {
  it('shows the balance with the rupee hint', () => {
    const out = html({ credits: credits() });
    expect(out).toContain('1,520 credits');
    expect(out).toContain('≈ ₹152');
    expect(out).not.toContain('role="alert"');
  });

  it('says "1 credit" for exactly one, and never invents a hint without the published rate', () => {
    expect(html({ credits: credits({ balance: 1 }) })).toContain('1 credit<');
    expect(html({ credits: credits({ inrPerCredit: null }) })).not.toContain('₹');
    // Anything that shows as "1" is singular too (review R, nits).
    expect(html({ credits: credits({ balance: 1.004 }) })).toContain('1 credit<');
  });

  it('shows a negative balance as taken from the next credits', () => {
    const out = html({ credits: credits({ balance: -50, available: -50, debt: 50 }) });
    expect(out).toContain('−50 credits');
    expect(out).toContain('taken from your next credits');
    expect(out).not.toContain('₹');
  });

  it('warns, in words and politely, when credits run low', () => {
    const out = html({ credits: credits({ balance: 150 }) });
    expect(out).toContain('Running low: 150 credits left this cycle');
    expect(out).toContain('role="status">Running low');
    expect(html({ credits: credits({ balance: 150, plan: 'free' }) })).toContain('Running low: 150 credits left<');
    expect(html({ credits: credits({ balance: 1500 }) })).not.toContain('Running low');
  });

  it('renders nothing when signed out or before the balance is read', () => {
    expect(html({ credits: null })).toBe('');
    expect(html({})).toBe('');
  });
});

describe('the blocked state (402 credits_exhausted)', () => {
  const props = { credits: credits({ balance: 0, available: 0 }), block: 'credits_exhausted' };

  it('says so in an alert, shows the balance and offers Upgrade and Buy credits', () => {
    const out = html(props);
    expect(out).toContain('role="alert"');
    expect(out).toContain('You have no AI credits left to start an answer.');
    expect(out).toContain('0 credits');
    expect(out).toContain('>Upgrade</button>');
    expect(out).toContain('>Buy credits</button>');
  });

  it('shows the actions even before the balance is known', () => {
    const out = html({ credits: null, block: 'credits_exhausted' });
    expect(out).toContain('>Upgrade</button>');
    expect(out).not.toContain('ai-credit-line');
  });

  it('opens Plan & billing from either action', () => {
    const open = vi.fn();
    const tree = CreditBalance({ ...props, onOpenBilling: open });
    buttonLabelled(tree, 'Upgrade').props.onClick();
    buttonLabelled(tree, 'Buy credits').props.onClick();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('says the credits are in use by a running answer, and offers no way to buy, when the refusal says held (review R, M2)', () => {
    const out = html({ credits: credits({ balance: 500, held: 500, available: 0 }), block: 'credits_exhausted', held: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Your credits are in use by an answer that is still running. Try again when it finishes.');
    expect(out).toContain('500 credits');
    expect(out).not.toContain('You have no AI credits left');
    expect(out).not.toContain('Upgrade');
    expect(out).not.toContain('Buy credits');
  });

  it('says the same when the balance is positive but all of it is held, even if the refusal did not say so', () => {
    const out = html({ credits: credits({ balance: 500, held: 500, available: 0 }), block: 'credits_exhausted' });
    expect(out).toContain('in use by an answer that is still running');
    expect(out).not.toContain('Upgrade');
    expect(out).not.toContain('Buy credits');
  });

  it('trusts held even before the balance is known', () => {
    const out = html({ credits: null, block: 'credits_exhausted', held: true });
    expect(out).toContain('in use by an answer that is still running');
    expect(out).not.toContain('Upgrade');
  });

  it('keeps today\'s blocked state when nothing is held: a zero balance, held not set', () => {
    for (const props of [{ held: false }, {}]) {
      const out = html({ credits: credits({ balance: 0, available: 0 }), block: 'credits_exhausted', ...props });
      expect(out).toContain('You have no AI credits left to start an answer.');
      expect(out).toContain('>Upgrade</button>');
      expect(out).toContain('>Buy credits</button>');
      expect(out).not.toContain('in use by an answer');
    }
  });

  it('keeps the Upgrade and Buy credits actions when the balance is negative', () => {
    const out = html({ credits: credits({ balance: -50, available: -50, debt: 50 }), block: 'credits_exhausted' });
    expect(out).toContain('>Upgrade</button>');
    expect(out).not.toContain('in use by an answer');
  });

  it('is gone once credits are available again, so the next question is not discouraged', () => {
    expect(html({ credits: credits({ balance: 400, available: 400 }), block: 'credits_exhausted' })).not.toContain('Upgrade');
  });
});

describe('the unchecked state (503 credits_unavailable)', () => {
  it('is a plain retry message, not the blocked state', () => {
    const retry = vi.fn();
    const out = html({ credits: credits(), block: 'credits_unavailable', onRetry: retry });
    expect(out).toContain('role="alert"');
    expect(out).toContain('AI credits could not be checked right now.');
    expect(out).toContain('>Try again</button>');
    expect(out).not.toContain('Upgrade');
    expect(out).not.toContain('Buy credits');
    buttonLabelled(CreditBalance({ credits: credits(), block: 'credits_unavailable', onRetry: retry }), 'Try again').props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offers no retry button when there is nothing to replay', () => {
    expect(html({ credits: credits(), block: 'credits_unavailable' })).not.toContain('>Try again</button>');
  });
});

describe('opening Plan & billing', () => {
  it('announces it on window for the shell, which owns the panel', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    try {
      const seen = vi.fn();
      target.addEventListener(OPEN_BILLING_EVENT, seen);
      openPlanBilling();
      expect(seen).toHaveBeenCalledOnce();
      expect(seen.mock.calls[0][0].detail).toEqual({ plan: null });
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('watchCredits', () => {
  it('reads the balance once when a signed-in panel opens, and follows the store until stopped', () => {
    let listener;
    const unsubscribe = vi.fn();
    const refresh = vi.fn(async () => null);
    const seen = [];
    const stop = watchCredits({ refresh, subscribe: (fn) => { listener = fn; return unsubscribe; }, onChange: (c) => seen.push(c) });
    expect(refresh).toHaveBeenCalledOnce();
    listener(credits());
    expect(seen).toHaveLength(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('survives a refresh that rejects', async () => {
    const refresh = vi.fn(async () => { throw new Error('offline'); });
    expect(() => watchCredits({ refresh, subscribe: () => () => {}, onChange() {} })).not.toThrow();
    await Promise.resolve();
  });
});
