# Supabase Setup & Auth Database Architecture

This guide describes the database structure and configuration required for the authentication and organisation management module.

## 🗄️ Database Tables Overview

| Table | Description |
|---|---|
| `auth.users` | Managed automatically by Supabase Auth (stores emails, hashed passwords, confirmation tokens) |
| `public.user_profiles` | Application user profile (`user_id`, `email`, `organisation_id`, `role`, `status`, name, department) |
| `public.organisations` | Organization entity records (`id`, `name`, `website`, `logo_url`, `about`) |
| `public.organisation_members` | Organization membership & role assignments (`user_id`, `organisation_id`, `role`, `status`) |
| `public.user_roles` | Role mapping support (`user_id`, `organisation_id`, `role`) |
| `public.organisation_invites` | Pending/accepted invitation tokens (`email`, `organisation_id`, `role`, `token`, `status`) |
| `public.privacy_policy_consents`| User consent logging for privacy policy compliance |

## 🚀 Running Migrations

To apply or verify the schema:
1. Open the [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor** -> **New Query**
3. Paste the contents of `backend/sql/auth_schema.sql`
4. Click **Run**

The migration script is completely **idempotent** and safe to execute multiple times.

## 🔒 Row-Level Security (RLS)

All public tables have RLS enabled:
- **`organisations`**: Users may view only the organisation they are a member of. Only users with role `owner` can update details.
- **`user_profiles`**: Users can view their own profile and profiles belonging to their team.
- **`organisation_invites`**: Only `owner` and `admin` roles can issue, list, and revoke team invitations.

## 📧 Email Configuration

In Supabase Dashboard under **Authentication** -> **URL Configuration**:
- **Site URL**: `https://niyantran.ai` (or your staging domain)
- **Redirect URLs**:
  - `http://localhost:5173/**`
  - `https://niyantran.ai/**`
  - `https://*.lovable.app/**`
