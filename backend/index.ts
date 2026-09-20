/**
 * Niyantran AI - Backend Auth & Organization Module
 * Unified Entrypoint
 */

// Services
export { authService } from "./src/services/authService";
export { organisationService } from "./src/services/organisationService";
export { inviteService } from "./src/services/inviteService";
export { emailService } from "./src/services/emailService";

// Controllers / HTTP API Handlers
export { authController } from "./src/routes/authController";

// Password Utilities & Generator
export { 
  generatePassword, 
  evaluatePasswordStrength,
  type PasswordGeneratorOptions,
  type PasswordStrengthResult 
} from "./src/utils/passwordGenerator";

// Validation Schemas & Types
export {
  emailSchema,
  passwordSchema,
  nameSchema,
  loginSchema,
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  inviteSchema,
  type LoginFormData,
  type SignupFormData,
  type ForgotPasswordFormData,
  type ResetPasswordFormData,
  type ChangePasswordFormData,
  type InviteFormData,
} from "./src/utils/validation";

// Auth & Org Types
export {
  type AppRole,
  type UserRole,
  type UserPersona,
  type UserPlan,
  type UserStatus,
  type OrganisationType,
  type OrganisationStatus,
  type MembershipStatus,
  type OrganisationMember,
  type Organisation,
  type UserProfile,
  type OrganisationInvite,
  type PrivacyPolicyConsent,
  type AuthUser,
  USER_PERSONAS,
  DEPARTMENTS,
  JOB_TITLES,
} from "./src/types/auth";

// Supabase Clients & DB Types
export { supabase, getSupabaseAdmin } from "./src/integrations/supabase/client";
export type { Database } from "./src/integrations/supabase/types";
