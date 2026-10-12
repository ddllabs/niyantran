/** A session enters the free terminal; otherwise email verification is required. */
export function nextSignupStep({ hasSession }) {
  return hasSession ? 'enter' : 'verify';
}
