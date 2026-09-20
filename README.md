# Niyantran Terminal (NTER)

Niyantran AI Strategic Intelligence & Terminal Systems.

## Switchable Authentication & Email Delivery Architecture

Niyantran AI features a **Switchable Authentication Email Delivery Architecture** that supports two interchangeable transactional email strategies without modifying frontend application code:

```
                    NTER Frontend
            (/#signup, /#login, /#forgot-password)
                         │
                         ▼
               Auth API Controller
          (/api/auth/signup, /forgot-password)
                         │
                         ▼
            Email Provider Abstraction
          (AUTH_EMAIL_PROVIDER env var)
                         │
          ┌──────────────┴──────────────┐
          │                             │
 [SUPABASE_NATIVE]                [RESEND_API]
          │                             │
supabase.auth.signUp()         admin.generateLink()
supabase.auth.resend()                  │
supabase.auth.resetPassword()      Resend API
          │                    (Branded Templates)
          │                             │
          └──────────────┬──────────────┘
                         ▼
                     User Inbox
```

---

### Delivery Modes

| Parameter | `SUPABASE_NATIVE` (Active Default) | `RESEND_API` (Future Production) |
| :--- | :--- | :--- |
| **Purpose** | Development, demo, and staging environments | Production deployment once custom domain is verified |
| **Configuration** | `AUTH_EMAIL_PROVIDER="SUPABASE_NATIVE"` | `AUTH_EMAIL_PROVIDER="RESEND_API"` |
| **Email Service** | Supabase Auth built-in email service / custom SMTP | Resend REST API (`https://api.resend.com/emails`) |
| **Action Link Gen** | Managed natively by Supabase Auth engine | `supabaseAdmin.auth.admin.generateLink()` |
| **Templates** | Supabase Dashboard Email Templates | Branded HTML templates (`server/templates/`) |
| **Credentials Req** | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Double Email Guard**| Zero Resend calls executed | Zero native Supabase confirmation emails triggered |

---

### Active Configuration

The active email delivery provider is: **`SUPABASE_NATIVE`**.

Provider diagnostics can be queried at:
```http
GET /api/auth/provider
Response: { "ok": true, "provider": "SUPABASE_NATIVE" }
```

---

### Switching to Resend Later (Production Transition)

Once the production domain (`niyantran.ai`) is added and verified in Resend:
1. **Verify Domain in Resend**:
   - Navigate to [Resend Dashboard → Domains](https://resend.com/domains).
   - Add `niyantran.ai` and configure the DNS records (DKIM, SPF, DMARC, MX).
2. **Update Environment Variables**:
   In your production deployment configuration:
   ```env
   AUTH_EMAIL_PROVIDER="RESEND_API"
   RESEND_FROM_EMAIL="Niyantran AI <auth@niyantran.ai>"
   RESEND_API_KEY="re_..."
   SUPABASE_SERVICE_ROLE_KEY="eyJhbGci..."
   ```
3. **Restart / Redeploy**:
   The server will validate credentials on startup and automatically switch to Resend API delivery without requiring any frontend code adjustments.

---

### Supabase Native Email Template Configuration

When operating in `SUPABASE_NATIVE` mode, email templates must be configured in:
**Supabase Dashboard → Authentication → Email Templates**

1. **Confirm Signup**:
   - **Subject**: `Confirm your Niyantran AI account`
   - **Body content**: Ensure `{{ .ConfirmationURL }}` is present as the action URL.
2. **Reset Password**:
   - **Subject**: `Reset your Niyantran AI password`
   - **Body content**: Ensure `{{ .ConfirmationURL }}` is present as the recovery action URL.

> [!NOTE]
> If Supabase native emails encounter delivery issues or rate limits on the free tier, configure custom SMTP in **Project Settings → Authentication → SMTP Settings** with your corporate SMTP credentials or Resend SMTP (`smtp.resend.com`).

---

### Redirect URL Architecture

Action links for both modes point to the centralized URL resolver:
`process.env.APP_URL` → `process.env.SITE_URL` → Request Host → `http://localhost:5173`

- **Signup Confirmation**: Redirects to `/#login?verified=true`
- **Password Recovery**: Redirects to `/#reset-password`

#### Supabase Dashboard URL Allowlist:
In **Authentication → URL Configuration**:
- **Site URL**: `https://niyantran.ai` (production) or `http://localhost:5173` (local dev)
- **Redirect URLs**:
  - `https://niyantran.ai/**`
  - `https://niyantran.ai/#login`
  - `https://niyantran.ai/#reset-password`
  - `http://localhost:5173/**`
  - `http://localhost:5173/#login`
  - `http://localhost:5173/#reset-password`

---

### Security Guarantees
- **No Client Secrets**: `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and admin helpers never enter the client build. All client assets are scanned and confirmed clean.
- **Anti-Account Enumeration**: `/api/auth/forgot-password` always returns generic confirmation responses regardless of email existence or provider mode.
- **Strict Rate Limiting**: In-memory rate limiting prevents rapid abuse of email triggers.
