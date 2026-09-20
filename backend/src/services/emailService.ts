/**
 * Email Delivery Service using Resend
 * Handles verification emails, password recovery emails, and invitations.
 * Server-side execution only. Never invoke with client-side secrets.
 */

export interface SendEmailOptions {
  to: string;
  name?: string;
  confirmationUrl?: string;
  recoveryUrl?: string;
  token?: string;
}

export interface EmailDeliveryResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
}

const getEnvVar = (key: string): string | undefined => {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
};

function escapeHtml(str?: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const emailService = {
  /**
   * Send an account verification email via Resend
   */
  sendConfirmationEmail: async (options: SendEmailOptions): Promise<EmailDeliveryResult> => {
    return emailService.sendVerificationEmail(options);
  },

  sendVerificationEmail: async (options: SendEmailOptions): Promise<EmailDeliveryResult> => {
    const { to, name, confirmationUrl, token } = options;
    const apiKey = getEnvVar("RESEND_API_KEY") || "";
    const fromAddress = getEnvVar("RESEND_FROM_EMAIL") || "Niyantran AI <onboarding@resend.dev>";

    const displayName = name ? escapeHtml(name.trim()) : escapeHtml(to.split("@")[0]);
    const verifyUrl = confirmationUrl || `https://niyantran.ai/email-verified?token=${token || ""}`;
    const year = new Date().getFullYear();

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Verify your email address - Niyantran AI</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1120; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="560" style="max-width: 560px; width: 100%;">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; text-transform: uppercase;">NIYANTRAN AI</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #131d33; border: 1px solid #1e293b; border-radius: 12px; padding: 36px 32px;">
              <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">Verify your email address</h2>
              <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Welcome, <strong>${displayName}</strong>!</p>
              <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 28px 0;">Thanks for signing up for Niyantran AI. Please confirm your email address by clicking the button below to complete your account setup and activate your desk access.</p>
              <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 28px auto;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #0284c7;">
                    <a href="${verifyUrl}" target="_blank" style="font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; display: inline-block; background-color: #0284c7;">Confirm Email Address</a>
                  </td>
                </tr>
              </table>
              <div style="color: #64748b; font-size: 12px; line-height: 1.6; border-top: 1px solid #1e293b; padding-top: 20px;">
                <p style="margin: 0 0 6px 0;">If the button above doesn't work, copy and paste this link into your browser:</p>
                <a href="${verifyUrl}" target="_blank" style="color: #38bdf8; word-break: break-all;">${verifyUrl}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top: 24px; color: #475569; font-size: 12px;">
              <p style="margin: 0 0 4px 0;">If you did not create an account, you can safely ignore this email.</p>
              <p style="margin: 0;">&copy; ${year} Niyantran AI. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textContent = `Verify your email address - Niyantran AI\n\nWelcome, ${displayName}!\n\nThanks for signing up for Niyantran AI. Please confirm your email address by visiting the link below:\n\n${verifyUrl}\n\nIf you did not create an account, you can safely ignore this email.\n\n© ${year} Niyantran AI. All rights reserved.`;

    return emailService.dispatch({
      to,
      subject: "Verify your Niyantran AI account",
      html: htmlContent,
      text: textContent,
      from: fromAddress,
      apiKey,
    });
  },

  /**
   * Send a dedicated password recovery email via Resend
   */
  sendPasswordRecoveryEmail: async (options: SendEmailOptions): Promise<EmailDeliveryResult> => {
    const { to, recoveryUrl } = options;
    const apiKey = getEnvVar("RESEND_API_KEY") || "";
    const fromAddress = getEnvVar("RESEND_FROM_EMAIL") || "Niyantran AI <onboarding@resend.dev>";

    const displayName = escapeHtml(to.split("@")[0]);
    const resetUrl = recoveryUrl || "https://niyantran.ai/#reset-password";
    const year = new Date().getFullYear();

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Reset your password - Niyantran AI</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1120; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="560" style="max-width: 560px; width: 100%;">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; text-transform: uppercase;">NIYANTRAN AI</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #131d33; border: 1px solid #1e293b; border-radius: 12px; padding: 36px 32px;">
              <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">Reset your password</h2>
              <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hello <strong>${displayName}</strong>,</p>
              <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">We received a request to reset the password for your Niyantran AI account. Click the button below to choose a new password:</p>
              <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 28px auto;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                    <a href="${resetUrl}" target="_blank" style="font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; display: inline-block; background-color: #2563eb;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <div style="background-color: #1e293b; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; border-left: 3px solid #f59e0b;">
                <p style="color: #f1f5f9; font-size: 13px; line-height: 1.5; margin: 0;">
                  <strong>Security Notice:</strong> If you did not request a password reset, you can safely ignore this email. Your password will not be changed unless you complete the reset process above.
                </p>
              </div>
              <div style="color: #64748b; font-size: 12px; line-height: 1.6; border-top: 1px solid #1e293b; padding-top: 20px;">
                <p style="margin: 0 0 6px 0;">If the button above doesn't work, copy and paste this link into your browser:</p>
                <a href="${resetUrl}" target="_blank" style="color: #38bdf8; word-break: break-all;">${resetUrl}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top: 24px; color: #475569; font-size: 12px;">
              <p style="margin: 0;">&copy; ${year} Niyantran AI. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textContent = `Reset your password - Niyantran AI\n\nHello ${displayName},\n\nWe received a request to reset your password. Use the link below to choose a new password:\n\n${resetUrl}\n\nSECURITY NOTICE: If you did not request a password reset, you can safely ignore this email.\n\n© ${year} Niyantran AI. All rights reserved.`;

    return emailService.dispatch({
      to,
      subject: "Reset your Niyantran AI password",
      html: htmlContent,
      text: textContent,
      from: fromAddress,
      apiKey,
    });
  },

  /**
   * Internal dispatcher calling Resend API
   */
  dispatch: async ({
    to,
    subject,
    html,
    text,
    from,
    apiKey,
  }: {
    to: string;
    subject: string;
    html: string;
    text: string;
    from: string;
    apiKey: string;
  }): Promise<EmailDeliveryResult> => {
    if (!apiKey) {
      return { ok: true, simulated: true, messageId: `sim_${Date.now()}` };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
          text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { ok: false, error: data.message || "Failed to send email via Resend" };
      }

      return { ok: true, messageId: data.id };
    } catch (err: any) {
      return { ok: false, error: err.message || "Network error sending email" };
    }
  },
};
