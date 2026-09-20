import { describe, expect, it } from 'vitest';
import { userFromSupabase } from './userStore.js';

const USER = { id: 'uid-1', email: 'Person@Example.org', created_at: '2026-09-21T00:00:00Z' };

describe('userFromSupabase', () => {
  it('maps the profile persona to the frontend type and normalises plan and email', () => {
    const u = userFromSupabase(USER, { first_name: 'Pat', last_name: 'Lee', persona: 'upsc_aspirant', plan: 'professional', role: 'admin', status: 'active', onboarding_complete: true });
    expect(u).toMatchObject({ id: 'uid-1', email: 'person@example.org', name: 'Pat Lee', type: 'student', personaId: 'student', plan: 'pro', role: 'admin', active: true, onboardingComplete: true, supabase: true });
    expect(u.password).toBeUndefined();
  });

  it('falls back to the signup persona when the profile has none, and to the email local part for the name', () => {
    const u = userFromSupabase(USER, { persona: null }, { personaId: 'policy', plan: 'pro', planStatus: 'trial', trialEndsAt: '2026-10-05T00:00:00Z' });
    expect(u.type).toBe('policy');
    expect(u.name).toBe('person');
    expect(u.plan).toBe('pro');
    expect(u.planStatus).toBe('trial');
    expect(u.trialEndsAt).toBe('2026-10-05T00:00:00Z');
  });

  it('marks suspended and inactive profiles inactive, and returns null without a user id', () => {
    expect(userFromSupabase(USER, { status: 'suspended' }).active).toBe(false);
    expect(userFromSupabase(USER, { status: 'inactive' }).active).toBe(false);
    expect(userFromSupabase(USER, null).active).toBe(true);
    expect(userFromSupabase(null, {})).toBeNull();
  });
});
