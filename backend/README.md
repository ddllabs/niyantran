# Backend Authentication & Organisation Module

This module contains the authentication, organization management, and database integration extracted from `tenderbase-onboard`.

## 📁 Directory Structure

```text
backend/
├── index.ts                      # Central export entrypoint
├── package.json                  # Dependencies manifest
├── sql/
│   ├── auth_schema.sql           # Complete idempotent SQL database schema
│   └── SUPABASE_SETUP.md         # Database documentation & setup instructions
├── src/
│   ├── config/
│   │   └── domains.ts            # Base URLs and domain helpers
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts         # Supabase client (standard & admin service-role)
│   │       └── types.ts          # Database schema type definitions
│   ├── routes/
│   │   └── authController.ts     # HTTP API endpoints for Express/REST
│   ├── services/
│   │   ├── authService.ts        # Signup, login, logout, password reset, profile
│   │   ├── organisationService.ts# Organisation CRUD, members, roles, transfers
│   │   └── inviteService.ts      # Team invitations (create, resend, revoke)
│   ├── types/
│   │   └── auth.ts               # Authoritative TypeScript types & enums
│   └── utils/
│       ├── passwordGenerator.ts  # Secure password generation & strength analyzer
│       └── validation.ts         # Zod schemas for input validation
└── supabase/
    └── functions/                # Deno Edge Functions
        ├── _shared/              # CORS headers and domain helpers
        ├── send-invite/          # Edge function for sending invitations
        ├── send-custom-invite-email/ # Edge function for sending branded emails
        └── remove-member/        # Edge function for safe member removal
```

## 🛠️ Usage Example

```typescript
import { 
  authService, 
  organisationService, 
  generatePassword, 
  evaluatePasswordStrength 
} from './backend';

// Generate a random secure password
const password = generatePassword({ length: 16 });
const strength = evaluatePasswordStrength(password);

// Sign up a user
const { user, error } = await authService.signup(
  "analyst@example.com",
  password,
  "John",
  "Doe"
);

// Log in
const session = await authService.login("analyst@example.com", password);
```
