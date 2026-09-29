/**
 * The message a failed signUp shows. Supabase Auth reports a database refusal
 * only as "Database error saving new user"; the one refusal a normal signup
 * can hit is the unique normalised email (migration 20260929110000_email_unique),
 * where the address folds onto an existing account.
 */
const FALLBACK = 'Failed to create account. Please check your details.';

export function signupErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!message) return FALLBACK;
  if (/database error saving new user/i.test(message)) {
    return 'This email already has an account (Gmail ignores dots and +tags, so those count as the same address). Sign in instead, or reset your password.';
  }
  return message;
}
