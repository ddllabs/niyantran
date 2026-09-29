// F24: signup has two steps (owner decision C7, 2026-09-28), but the second one,
// "Choose plan", was never reached. After an email signup that returns a session:
// a free pick goes to the plan step, where a trial can start; a Pro or Enterprise
// pick already has its trial from handle_new_user() and goes straight in. A
// signup waiting on email verification shows the verification notice.
import { describe, expect, it } from 'vitest';
import { nextSignupStep } from './signupFlow.js';

describe('nextSignupStep', () => {
  it('sends a free signup with a session to the plan step', () => {
    expect(nextSignupStep({ hasSession: true, planId: 'explorer' })).toBe('plan');
    expect(nextSignupStep({ hasSession: true, planId: '' })).toBe('plan');
    expect(nextSignupStep({ hasSession: true, planId: undefined })).toBe('plan');
  });

  it('sends a trial pick straight into the terminal: the server already started it', () => {
    expect(nextSignupStep({ hasSession: true, planId: 'pro' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: 'professional' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: 'enterprise' })).toBe('enter');
  });

  it('waits for email verification when there is no session yet', () => {
    expect(nextSignupStep({ hasSession: false, planId: 'pro' })).toBe('verify');
    expect(nextSignupStep({ hasSession: false, planId: 'explorer' })).toBe('verify');
  });
});
