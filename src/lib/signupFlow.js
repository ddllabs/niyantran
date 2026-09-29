import { normalizePlanId } from './planEntitlements.js';

/**
 * Where an email signup goes next (open-work F24). Signup has two steps (owner
 * decision C7): the account, then the plan. A Pro or Enterprise pick carried in
 * the signup metadata has already started its trial in handle_new_user(), so it
 * enters the terminal; a free pick sees the plan step, where it can start one.
 * Without a session the account is waiting on email verification.
 *
 * @param {{ hasSession: boolean, planId?: string }} input
 * @returns {'verify' | 'plan' | 'enter'}
 */
export function nextSignupStep({ hasSession, planId }) {
  if (!hasSession) return 'verify';
  const plan = normalizePlanId(planId || 'explorer');
  return plan === 'pro' || plan === 'enterprise' ? 'enter' : 'plan';
}
