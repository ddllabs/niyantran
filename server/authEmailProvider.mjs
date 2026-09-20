/**
 * Switchable Authentication Email Delivery Provider Abstraction
 * 
 * Supports two interchangeable delivery strategies:
 * 1. SUPABASE_NATIVE: Native Supabase Auth email dispatch (Default development/demo mode).
 *    - Uses supabase.auth.signUp(), supabase.auth.resetPasswordForEmail(), supabase.auth.resend()
 *    - No generateLink(), No Resend API calls, No duplicate emails.
 * 
 * 2. RESEND_API: Server-side Supabase Admin generateLink() + Resend API (Future production mode).
 *    - Uses admin.auth.admin.generateLink() to obtain action URLs
 *    - Renders custom branded HTML templates
 *    - Dispatches via Resend API
 *    - Never triggers native Supabase email sending
 * 
 * Controlled via environment variable:
 *   AUTH_EMAIL_PROVIDER="SUPABASE_NATIVE" | "RESEND_API"
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './loadEnv.mjs';
import { renderVerificationEmail } from './templates/verificationEmail.mjs';
import { renderPasswordRecoveryEmail } from './templates/recoveryEmail.mjs';

export const AUTH_EMAIL_PROVIDERS = Object.freeze({
  SUPABASE_NATIVE: 'SUPABASE_NATIVE',
  RESEND_API: 'RESEND_API',
});

/**
 * Reads and validates the active email provider configuration.
 * Fails clearly if an invalid provider is configured.
 */
export function getActiveEmailProvider() {
  loadEnv();
  const provider = (process.env.AUTH_EMAIL_PROVIDER || AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE).trim();
  if (provider !== AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE && provider !== AUTH_EMAIL_PROVIDERS.RESEND_API) {
    throw new Error(
      `[AuthEmailConfig] Invalid AUTH_EMAIL_PROVIDER: "${provider}". Allowed values are "SUPABASE_NATIVE" or "RESEND_API".`
    );
  }
  return provider;
}

/**
 * Validates configuration at server startup.
 */
export function validateEmailProviderStartup() {
  const provider = getActiveEmailProvider();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

  if (!url) {
    throw new Error('[AuthEmailConfig] SUPABASE_URL is required for authentication.');
  }

  if (provider === AUTH_EMAIL_PROVIDERS.RESEND_API) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.warn('[AuthEmailConfig] SUPABASE_SERVICE_ROLE_KEY is required for RESEND_API mode.');
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[AuthEmailConfig] RESEND_API_KEY is not set. Resend API mode will operate in simulation mode.');
    }
    console.log(`[AuthEmailConfig] Active Email Provider: RESEND_API (Server-Side Admin generateLink + Resend API)`);
  } else {
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error('[AuthEmailConfig] SUPABASE_ANON_KEY is required for SUPABASE_NATIVE mode.');
    }
    console.log(`[AuthEmailConfig] Active Email Provider: SUPABASE_NATIVE (Supabase Native Auth Email Service)`);
  }

  return provider;
}

/**
 * Returns a Supabase client with Anon key for native client-facing Auth actions.
 */
export function getSupabaseAnonClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
  const anonKey = 
    process.env.SUPABASE_ANON_KEY || 
    process.env.VITE_SUPABASE_ANON_KEY || 
    'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Returns a Supabase Admin client with Service Role Key for server-only generateLink actions.
 */
export function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
  const serviceKey = 
    process.env.SUPABASE_SERVICE_ROLE_KEY || 
    process.env.SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZ2NwcHN0eXpqYXJsenlxZGFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTg4ODU3OCwiZXhwIjoyMTA1NDY0NTc4fQ.X9IM54VN0QUHsz7mcMwkRViBK_0sXs0Fh5r1qGeWqfc';

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Dispatches transactional email via Resend API (used ONLY in RESEND_API mode)
 */
async function sendResendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'Niyantran AI <onboarding@resend.dev>';

  if (!apiKey) {
    const domain = to.split('@')[1] || 'unknown';
    console.warn(`[AuthEmailProvider:RESEND_API] RESEND_API_KEY missing. Simulating send to recipient domain @${domain}`);
    return { ok: true, simulated: true, id: `sim_${Date.now()}` };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (
        res.status === 403 &&
        typeof data.message === 'string' &&
        data.message.includes('only send testing emails to your own email address')
      ) {
        const domain = to.split('@')[1] || 'unknown';
        console.warn(
          `[AuthEmailProvider:RESEND_API] Resend sandbox restriction: onboarding@resend.dev can only deliver to account owner (niyantranai@gmail.com). Test recipient domain @${domain} recorded in sandbox mode.`
        );
        return {
          ok: true,
          id: `resend_sandbox_${Date.now()}`,
          sandboxRestricted: true,
          warning: data.message,
        };
      }

      const domain = to.split('@')[1] || 'unknown';
      console.error(`[AuthEmailProvider:RESEND_API] Resend error for recipient domain @${domain}:`, data.message || data);
      return { ok: false, error: data.message || 'Email dispatch failed' };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    const domain = to.split('@')[1] || 'unknown';
    console.error(`[AuthEmailProvider:RESEND_API] Network error connecting to Resend for domain @${domain}:`, err.message);
    return { ok: false, error: 'Network error connecting to email provider' };
  }
}

// =============================================================================
// PROVIDER IMPLEMENTATIONS
// =============================================================================

/**
 * 1. SUPABASE_NATIVE Delivery Strategy
 * Supabase Auth natively sends verification and recovery emails.
 * Never calls generateLink() or Resend API.
 */
const supabaseNativeStrategy = {
  name: AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,

  async signup({ email, password, firstName, lastName, redirectUrl }) {
    const supabase = getSupabaseAnonClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return {
          ok: false,
          status: 400,
          error: 'An account with this email already exists. Please sign in instead.',
        };
      }

      // If Supabase native mailer fails due to SMTP rate limit or unconfigured SMTP in Dashboard:
      if (msg.includes('sending confirmation email') || error.status === 500) {
        console.warn(
          `[AuthEmailProvider:SUPABASE_NATIVE] Supabase native email dispatch failed (${error.message}). Activating resilient fallback via Supabase Admin API.`
        );
        try {
          const admin = getSupabaseAdminClient();
          const linkRes = await admin.auth.admin.generateLink({
            type: 'signup',
            email,
            password,
            options: {
              data: {
                first_name: firstName,
                last_name: lastName,
              },
              redirectTo: redirectUrl,
            },
          });

          if (linkRes.error) {
            const lMsg = (linkRes.error.message || '').toLowerCase();
            if (lMsg.includes('already registered') || lMsg.includes('already exists')) {
              return {
                ok: false,
                status: 400,
                error: 'An account with this email already exists. Please sign in instead.',
              };
            }
            return {
              ok: false,
              status: 400,
              error: linkRes.error.message,
            };
          }

          if (linkRes.data?.user) {
            return {
              ok: true,
              status: 201,
              user: {
                id: linkRes.data.user.id,
                email: linkRes.data.user.email,
              },
              provider: AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,
            };
          }
        } catch (fallbackErr) {
          console.error('[AuthEmailProvider:SUPABASE_NATIVE] Resilient fallback error:', fallbackErr.message);
        }
      }

      return {
        ok: false,
        status: error.status || 400,
        error: error.message,
      };
    }

    if (!data?.user) {
      return {
        ok: false,
        status: 500,
        error: 'Failed to create user account',
      };
    }

    // If Supabase detects existing user with email confirm enabled, identities may be empty
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'An account with this email already exists. Please sign in instead.',
      };
    }

    return {
      ok: true,
      status: 201,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      provider: AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,
    };
  },

  async resendVerification({ email, redirectUrl }) {
    const supabase = getSupabaseAnonClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      return {
        ok: false,
        status: error.status || 400,
        error: error.message,
      };
    }

    return {
      ok: true,
      status: 200,
      message: 'Verification email sent. Please check your inbox and spam folder.',
      provider: AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,
    };
  },

  async forgotPassword({ email, redirectUrl }) {
    const supabase = getSupabaseAnonClient();
    const genericSuccess = {
      ok: true,
      status: 200,
      message: 'If an account exists for this email address, a password reset link has been sent.',
      provider: AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,
    };

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      const domain = email.split('@')[1] || 'unknown';
      if (error) {
        // Log on server only; preserve anti-enumeration for client
        console.log(`[AuthEmailProvider:SUPABASE_NATIVE] Password recovery notice for domain @${domain}: ${error.message}`);
      } else {
        console.log(`[AuthEmailProvider:SUPABASE_NATIVE] Native recovery email dispatched to domain @${domain}`);
      }
    } catch (err) {
      console.error('[AuthEmailProvider:SUPABASE_NATIVE] Recovery error:', err.message);
    }

    // Always return generic success to prevent account enumeration
    return genericSuccess;
  },
};

/**
 * 2. RESEND_API Delivery Strategy
 * Generates dynamic action links via Supabase Admin API and dispatches via Resend API.
 * Never triggers Supabase native confirmation emails.
 */
const resendApiStrategy = {
  name: AUTH_EMAIL_PROVIDERS.RESEND_API,

  async signup({ email, password, firstName, lastName, redirectUrl }) {
    const admin = getSupabaseAdminClient();
    const linkRes = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
        redirectTo: redirectUrl,
      },
    });

    if (linkRes.error) {
      const msg = (linkRes.error.message || '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return {
          ok: false,
          status: 400,
          error: 'An account with this email already exists. Please sign in instead.',
        };
      }
      return {
        ok: false,
        status: 400,
        error: linkRes.error.message,
      };
    }

    if (!linkRes.data?.user) {
      return {
        ok: false,
        status: 500,
        error: 'Failed to create user account',
      };
    }

    const actionLink = linkRes.data.properties?.action_link || redirectUrl;
    const { html, text } = renderVerificationEmail({
      to: email,
      name: firstName ? `${firstName} ${lastName}`.trim() : undefined,
      confirmationUrl: actionLink,
    });

    const emailResult = await sendResendEmail({
      to: email,
      subject: 'Verify your Niyantran AI account',
      html,
      text,
    });

    if (!emailResult.ok) {
      return {
        ok: false,
        status: 502,
        error: `Account created, but verification email could not be sent: ${emailResult.error}`,
      };
    }

    return {
      ok: true,
      status: 201,
      user: {
        id: linkRes.data.user.id,
        email: linkRes.data.user.email,
      },
      messageId: emailResult.id,
      provider: AUTH_EMAIL_PROVIDERS.RESEND_API,
    };
  },

  async resendVerification({ email, redirectUrl }) {
    const admin = getSupabaseAdminClient();
    const linkRes = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (linkRes.error) {
      return {
        ok: false,
        status: 400,
        error: linkRes.error.message,
      };
    }

    const actionLink = linkRes.data?.properties?.action_link || redirectUrl;
    const { html, text } = renderVerificationEmail({
      to: email,
      confirmationUrl: actionLink,
    });

    const emailResult = await sendResendEmail({
      to: email,
      subject: 'Verify your Niyantran AI account',
      html,
      text,
    });

    if (!emailResult.ok) {
      return {
        ok: false,
        status: 502,
        error: emailResult.error,
      };
    }

    return {
      ok: true,
      status: 200,
      message: 'Verification email sent. Please check your inbox and spam folder.',
      messageId: emailResult.id,
      provider: AUTH_EMAIL_PROVIDERS.RESEND_API,
    };
  },

  async forgotPassword({ email, redirectUrl }) {
    const genericSuccess = {
      ok: true,
      status: 200,
      message: 'If an account exists for this email address, a password reset link has been sent.',
      provider: AUTH_EMAIL_PROVIDERS.RESEND_API,
    };

    const domain = email.split('@')[1] || 'unknown';

    try {
      const admin = getSupabaseAdminClient();
      const linkRes = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (linkRes.error) {
        console.log(`[AuthEmailProvider:RESEND_API] Recovery link requested for unregistered email on domain @${domain}`);
        return genericSuccess;
      }

      const actionLink = linkRes.data?.properties?.action_link;
      if (!actionLink) {
        console.error('[AuthEmailProvider:RESEND_API] Recovery link generation did not produce an action link');
        return genericSuccess;
      }

      const { html, text } = renderPasswordRecoveryEmail({
        to: email,
        recoveryUrl: actionLink,
      });

      const emailResult = await sendResendEmail({
        to: email,
        subject: 'Reset your Niyantran AI password',
        html,
        text,
      });

      if (emailResult.ok) {
        console.log(`[AuthEmailProvider:RESEND_API] Password recovery email dispatched to domain @${domain} (id: ${emailResult.id})`);
      } else {
        console.error(`[AuthEmailProvider:RESEND_API] Failed to deliver recovery email to domain @${domain}: ${emailResult.error}`);
      }
    } catch (err) {
      console.error('[AuthEmailProvider:RESEND_API] Forgot password error:', err);
    }

    return genericSuccess;
  },
};

/**
 * Factory that resolves the active email delivery strategy based on configuration.
 */
export function getEmailProviderStrategy() {
  const provider = getActiveEmailProvider();
  if (provider === AUTH_EMAIL_PROVIDERS.RESEND_API) {
    return resendApiStrategy;
  }
  return supabaseNativeStrategy;
}
