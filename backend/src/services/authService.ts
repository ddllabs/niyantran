import { supabase, getSupabaseAdmin } from "../integrations/supabase/client";
import { AuthUser } from "../types/auth";
import { getAppBaseUrl } from "../config/domains";
import { generatePassword, PasswordGeneratorOptions, evaluatePasswordStrength, PasswordStrengthResult } from "../utils/passwordGenerator";
import { emailService } from "./emailService";

export const authService = {
  /**
   * Generates a cryptographically strong, random password
   */
  generatePassword: (options?: PasswordGeneratorOptions): string => {
    return generatePassword(options);
  },

  /**
   * Evaluates the strength of a password
   */
  checkPasswordStrength: (password: string): PasswordStrengthResult => {
    return evaluatePasswordStrength(password);
  },

  /**
   * Sign up a new user
   */
  signup: async (
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<{ user: AuthUser | null; error: string | null }> => {
    const appBaseUrl = getAppBaseUrl();
    const redirectUrl = `${appBaseUrl}/#login?verified=true`;

    let userRecord: any = null;
    let confirmationUrl: string = redirectUrl;

    const provider = (process.env.AUTH_EMAIL_PROVIDER || "SUPABASE_NATIVE").trim();

    if (provider === "SUPABASE_NATIVE") {
      try {
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
            return { user: null, error: "An account with this email already exists. Please login instead." };
          }
          return { user: null, error: error.message };
        }

        if (!data?.user) {
          return { user: null, error: "Failed to create user account" };
        }

        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return { user: null, error: "An account with this email already exists. Please login instead." };
        }

        userRecord = data.user;
      } catch (err: any) {
        return { user: null, error: err?.message || "Signup failed" };
      }
    } else {
      // RESEND_API mode
      try {
        const admin = getSupabaseAdmin();
        const linkRes = await admin.auth.admin.generateLink({
          type: "signup",
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
            return { user: null, error: "An account with this email already exists. Please login instead." };
          }
          return { user: null, error: linkRes.error.message };
        }

        if (!linkRes.data?.user) {
          return { user: null, error: "Failed to create user account" };
        }

        userRecord = linkRes.data.user;
        confirmationUrl = linkRes.data.properties?.action_link || redirectUrl;

        // Dispatch confirmation email via Resend
        await emailService.sendConfirmationEmail({
          to: email,
          name: firstName ? `${firstName} ${lastName || ""}`.trim() : undefined,
          confirmationUrl,
        });
      } catch (err: any) {
        return { user: null, error: err?.message || "Signup failed" };
      }
    }

    // Get profile to check organisation and onboarding status
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("organisation_id, onboarding_complete")
      .eq("user_id", userRecord.id)
      .maybeSingle();

    const authUser: AuthUser = {
      id: userRecord.id,
      email: userRecord.email!,
      organisationId: profile?.organisation_id ?? undefined,
      onboardingComplete: profile?.onboarding_complete ?? false,
    };

    return { user: authUser, error: null };
  },

  /**
   * Resend signup verification email via Supabase + Resend
   */
  resendVerification: async (email: string): Promise<{ error: string | null }> => {
    const appBaseUrl = getAppBaseUrl();
    const redirectUrl = `${appBaseUrl}/#login?verified=true`;
    const provider = (process.env.AUTH_EMAIL_PROVIDER || "SUPABASE_NATIVE").trim();

    if (provider === "SUPABASE_NATIVE") {
      try {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: {
            emailRedirectTo: redirectUrl,
          },
        });
        if (error) return { error: error.message };
        return { error: null };
      } catch (err: any) {
        return { error: err?.message || "Failed to resend confirmation email" };
      }
    } else {
      // RESEND_API mode
      try {
        const admin = getSupabaseAdmin();
        const linkRes = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: {
            redirectTo: redirectUrl,
          },
        });

        const confirmationUrl = linkRes.data?.properties?.action_link || redirectUrl;
        await emailService.sendConfirmationEmail({
          to: email,
          confirmationUrl,
        });

        return { error: null };
      } catch (err: any) {
        return { error: err?.message || "Failed to resend confirmation email" };
      }
    }
  },

  /**
   * Log in an existing user
   */
  login: async (
    email: string,
    password: string
  ): Promise<{ user: AuthUser | null; error: string | null }> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("email not confirmed")) {
        return { user: null, error: "EMAIL_NOT_VERIFIED" };
      }
      return { user: null, error: error.message };
    }
    if (!data.user) return { user: null, error: "Login failed" };

    // Safety check for email confirmation if enforced
    if (data.user.email_confirmed_at === null && data.session === null) {
      return { user: null, error: "EMAIL_NOT_VERIFIED" };
    }

    // Get profile to check organisation and account status
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("organisation_id, onboarding_complete, status")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profile?.status === "inactive" || profile?.status === "suspended") {
      await supabase.auth.signOut();
      return { user: null, error: "Your account is deactivated or suspended. Please contact support." };
    }

    // Also check organisation_members table if not in profile
    let orgId = profile?.organisation_id;
    if (!orgId) {
      const { data: member } = await supabase
        .from("organisation_members")
        .select("organisation_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (member?.organisation_id) {
        orgId = member.organisation_id;
      }
    }

    const authUser: AuthUser = {
      id: data.user.id,
      email: data.user.email!,
      organisationId: orgId ?? undefined,
      onboardingComplete: profile?.onboarding_complete ?? false,
    };

    return { user: authUser, error: null };
  },

  /**
   * Log out current session
   */
  logout: async (): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signOut();
    if (error) return { error: error.message };
    return { error: null };
  },

  /**
   * Get current authenticated user session
   */
  getCurrentUser: async (): Promise<AuthUser | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) return null;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("organisation_id, onboarding_complete, status")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (profile?.status === "inactive" || profile?.status === "suspended") {
      await supabase.auth.signOut();
      return null;
    }

    let orgId = profile?.organisation_id;
    if (!orgId) {
      const { data: member } = await supabase
        .from("organisation_members")
        .select("organisation_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (member?.organisation_id) {
        orgId = member.organisation_id;
      }
    }

    return {
      id: session.user.id,
      email: session.user.email!,
      organisationId: orgId ?? undefined,
      onboardingComplete: profile?.onboarding_complete ?? false,
    };
  },

  /**
   * Initiate forgot password flow with email reset link
   */
  forgotPassword: async (email: string): Promise<{ error: string | null }> => {
    const appBaseUrl = getAppBaseUrl();
    const redirectUrl = `${appBaseUrl}/#reset-password`;
    const provider = (process.env.AUTH_EMAIL_PROVIDER || "SUPABASE_NATIVE").trim();
    
    if (provider === "SUPABASE_NATIVE") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.log(`[authService] Native password recovery requested for domain @${email.split('@')[1] || 'unknown'}`);
      }
      return { error: null }; // Anti-enumeration
    } else {
      // RESEND_API mode
      try {
        const admin = getSupabaseAdmin();
        const linkRes = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: {
            redirectTo: redirectUrl,
          },
        });

        if (linkRes.error) {
          return { error: null }; // Anti-enumeration
        }

        const recoveryUrl = linkRes.data?.properties?.action_link || redirectUrl;
        await emailService.sendPasswordRecoveryEmail({
          to: email,
          recoveryUrl,
        });

        return { error: null };
      } catch (err: any) {
        return { error: null }; // Anti-enumeration
      }
    }
  },

  /**
   * Reset password for current recovered session
   */
  resetPassword: async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) return { error: error.message };
    return { error: null };
  },

  /**
   * Update current user's profile information
   */
  updateMyProfile: async (data: { 
    firstName?: string; 
    lastName?: string;
    phoneE164?: string;
    department?: string;
    jobTitle?: string;
  }): Promise<{ error: string | null }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.firstName !== undefined) updatePayload.first_name = data.firstName;
    if (data.lastName !== undefined) updatePayload.last_name = data.lastName;
    if (data.phoneE164 !== undefined) updatePayload.phone_e164 = data.phoneE164;
    if (data.department !== undefined) updatePayload.department = data.department;
    if (data.jobTitle !== undefined) updatePayload.job_title = data.jobTitle;

    const { error } = await supabase
      .from("user_profiles")
      .update(updatePayload)
      .eq("user_id", user.id);

    if (error) return { error: error.message };
    return { error: null };
  },

  /**
   * Change password for users authenticated with email and password
   */
  changePassword: async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ error: string | null }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return { error: "User not found" };

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) return { error: "Current password is incorrect" };

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) return { error: error.message };
    return { error: null };
  },

  /**
   * Set password (for OAuth users who do not currently have a password)
   */
  setPassword: async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) return { error: error.message };
    return { error: null };
  },

  /**
   * Record user consent for privacy policy in privacy_policy_consents
   */
  recordPrivacyConsent: async (policyVersion: string = "1.0"): Promise<{ error: string | null }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { error } = await supabase
      .from("privacy_policy_consents")
      .insert({
        user_id: user.id,
        policy_version: policyVersion,
        accepted_at: new Date().toISOString(),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });

    if (error) return { error: error.message };
    return { error: null };
  },
};
