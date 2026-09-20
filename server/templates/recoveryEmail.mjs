/**
 * Production-Safe Responsive HTML Email Template for Password Recovery
 * Dedicated template adhering to Phase 6 security & visual guidelines.
 * Gmail, Outlook, Apple Mail, and Mobile Compatible.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderPasswordRecoveryEmail({ to, recoveryUrl, appName = 'Niyantran AI' }) {
  const currentYear = new Date().getFullYear();
  const displayName = escapeHtml(to.split('@')[0]);
  const safeUrl = recoveryUrl;

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset your password - ${escapeHtml(appName)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; padding: 20px 16px !important; }
      .email-card { padding: 24px 20px !important; }
      .btn { display: block !important; width: 100% !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1120; color: #f8fafc;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <!-- Email Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="560" class="email-container" style="max-width: 560px; width: 100%;">
          
          <!-- Header / Brand -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; text-transform: uppercase;">NIYANTRAN AI</span>
                    <div style="font-size: 11px; letter-spacing: 1.5px; color: #64748b; text-transform: uppercase; margin-top: 4px;">Security &amp; Account Recovery</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td class="email-card" style="background-color: #131d33; border: 1px solid #1e293b; border-radius: 12px; padding: 36px 32px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="color: #f8fafc; font-size: 20px; font-weight: 700; padding-bottom: 12px;">
                    Reset your password
                  </td>
                </tr>
                <tr>
                  <td style="color: #cbd5e1; font-size: 15px; line-height: 1.6; padding-bottom: 16px;">
                    Hello <strong>${displayName}</strong>,
                  </td>
                </tr>
                <tr>
                  <td style="color: #94a3b8; font-size: 14px; line-height: 1.6; padding-bottom: 24px;">
                    We received a request to reset the password for your ${escapeHtml(appName)} account. Click the button below to choose a new password:
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                          <a href="${safeUrl}" target="_blank" class="btn" style="font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; display: inline-block; background-color: #2563eb; border: 1px solid #2563eb;">
                            Reset Password
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Security Advisory -->
                <tr>
                  <td style="background-color: #1e293b; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; border-left: 3px solid #f59e0b;">
                    <p style="color: #f1f5f9; font-size: 13px; line-height: 1.5; margin: 0;">
                      <strong>Security Notice:</strong> If you did not request a password reset, you can safely ignore this email. Your password will not be changed unless you complete the reset process above.
                    </p>
                  </td>
                </tr>

                <!-- Fallback URL Section -->
                <tr>
                  <td style="color: #64748b; font-size: 12px; line-height: 1.6; border-top: 1px solid #1e293b; padding-top: 20px; margin-top: 20px;">
                    <p style="margin: 0 0 8px 0;">If the button above doesn't work, copy and paste the following link into your web browser:</p>
                    <a href="${safeUrl}" target="_blank" style="color: #38bdf8; word-break: break-all; text-decoration: underline; font-size: 12px;">${safeUrl}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 28px; color: #475569; font-size: 12px; line-height: 1.6;">
              <p style="margin: 0;">&copy; ${currentYear} ${escapeHtml(appName)}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Reset your password - ${appName}

Hello ${displayName},

We received a request to reset the password for your ${appName} account.

Use the link below to choose a new password:
${safeUrl}

SECURITY NOTICE:
If you did not request a password reset, you can safely ignore this email. Your password will not be changed unless you complete the reset process.

© ${currentYear} ${appName}. All rights reserved.`;

  return { html, text };
}
