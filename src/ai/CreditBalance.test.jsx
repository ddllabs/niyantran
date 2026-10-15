// F111, F184: the chat asks the shell to open Plan and invoices. F193: the chat box has no credit
// line; the balance and its messages are at the header pill (BalancePill.test.jsx).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_BILLING_EVENT, openPlanBilling } from './CreditBalance.jsx';

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

describe('no credit line by the chat box (F193)', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('keeps no balance component here, and no styles for one', () => {
    expect(read('./CreditBalance.jsx')).not.toMatch(/export default|BalanceRing|useCredits/);
    expect(read('./chat-presentation.css')).not.toMatch(/\.ai-credit(?:-line|-usage|-warn|-msg|-actions|-hint)?\b(?!-used)/);
  });

  it('has the chat panel hand its refusal to the pill, retrying through the latest recover', () => {
    const panel = read('./AiPanel.jsx');
    expect(panel).not.toContain('CreditBalance');
    expect(panel).toContain("import { publishCreditNotice } from './chatCreditNotice.js';");
    expect(panel).toContain("publishCreditNotice(creditBlock ? { block: creditBlock, held: creditHeld, retry: canRecover ? () => recoverRef.current?.() : null } : null);");
    expect(panel).toContain('useEffect(() => () => publishCreditNotice(null), []);');
  });
});
