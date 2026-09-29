// F10: a signup whose address folds onto an existing account (a Gmail alias,
// or the same address in other case) is refused by the database, and Supabase
// Auth reports only "Database error saving new user". The page says why.
import { describe, expect, it } from 'vitest';
import { signupErrorMessage } from './signupErrors.js';

describe('signupErrorMessage', () => {
  it('explains the duplicate-address refusal', () => {
    const message = signupErrorMessage({ message: 'Database error saving new user', status: 500 });
    expect(message).toMatch(/already has an account/);
    expect(message).toMatch(/Gmail/);
    expect(message).not.toMatch(/Database error/);
  });

  it('passes other Supabase messages through', () => {
    expect(signupErrorMessage({ message: 'Password should be at least 6 characters.' })).toBe('Password should be at least 6 characters.');
  });

  it('falls back when there is no message', () => {
    expect(signupErrorMessage(null)).toBe('Failed to create account. Please check your details.');
    expect(signupErrorMessage({})).toBe('Failed to create account. Please check your details.');
  });
});
