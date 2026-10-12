// Free desk access keeps email verification but removes signup plan selection.
import { describe, expect, it } from 'vitest';
import { nextSignupStep } from './signupFlow.js';

describe('nextSignupStep', () => {
  it('sends a free signup with a session directly into the terminal', () => {
    expect(nextSignupStep({ hasSession: true, planId: 'explorer' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: '' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: undefined })).toBe('enter');
  });

  it('treats legacy plan picks as free terminal entry', () => {
    expect(nextSignupStep({ hasSession: true, planId: 'pro' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: 'professional' })).toBe('enter');
    expect(nextSignupStep({ hasSession: true, planId: 'enterprise' })).toBe('enter');
  });

  it('waits for email verification when there is no session yet', () => {
    expect(nextSignupStep({ hasSession: false, planId: 'pro' })).toBe('verify');
    expect(nextSignupStep({ hasSession: false, planId: 'explorer' })).toBe('verify');
  });
});
