import { authService } from "../services/authService";
import { organisationService } from "../services/organisationService";
import { inviteService } from "../services/inviteService";
import { 
  signupSchema, 
  loginSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema, 
  changePasswordSchema,
  inviteSchema 
} from "../utils/validation";

const getErrorMessage = (error: any): string => {
  return error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Validation failed";
};

/**
 * REST / HTTP API Handlers for Auth Endpoints
 */
export const authController = {
  /**
   * POST /api/auth/signup
   */
  async handleSignup(body: any) {
    const parseResult = signupSchema.safeParse(body);
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    const { email, password, firstName, lastName } = parseResult.data;
    const result = await authService.signup(email, password, firstName, lastName);
    if (result.error) {
      return { status: 400, data: { ok: false, error: result.error } };
    }
    return { status: 201, data: { ok: true, user: result.user } };
  },

  /**
   * POST /api/auth/login
   */
  async handleLogin(body: any) {
    const parseResult = loginSchema.safeParse(body);
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    const { email, password } = parseResult.data;
    const result = await authService.login(email, password);
    if (result.error) {
      return { status: 401, data: { ok: false, error: result.error } };
    }
    return { status: 200, data: { ok: true, user: result.user } };
  },

  /**
   * POST /api/auth/logout
   */
  async handleLogout() {
    const result = await authService.logout();
    if (result.error) {
      return { status: 500, data: { ok: false, error: result.error } };
    }
    return { status: 200, data: { ok: true, message: "Logged out successfully" } };
  },

  /**
   * GET /api/auth/me
   */
  async handleGetCurrentUser() {
    const user = await authService.getCurrentUser();
    if (!user) {
      return { status: 401, data: { ok: false, error: "Not authenticated" } };
    }
    return { status: 200, data: { ok: true, user } };
  },

  /**
   * POST /api/auth/generate-password
   */
  handleGeneratePassword(options: any = {}) {
    const password = authService.generatePassword(options);
    const strength = authService.checkPasswordStrength(password);
    return { status: 200, data: { ok: true, password, strength } };
  },

  /**
   * POST /api/auth/forgot-password
   */
  async handleForgotPassword(body: any) {
    const parseResult = forgotPasswordSchema.safeParse(body);
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    const result = await authService.forgotPassword(parseResult.data.email);
    if (result.error) {
      return { status: 400, data: { ok: false, error: result.error } };
    }
    return { status: 200, data: { ok: true, message: "Password reset link sent" } };
  },

  /**
   * POST /api/auth/reset-password
   */
  async handleResetPassword(body: any) {
    const parseResult = resetPasswordSchema.safeParse(body);
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    const result = await authService.resetPassword(parseResult.data.password);
    if (result.error) {
      return { status: 400, data: { ok: false, error: result.error } };
    }
    return { status: 200, data: { ok: true, message: "Password reset successfully" } };
  },

  /**
   * POST /api/auth/change-password
   */
  async handleChangePassword(body: any) {
    const parseResult = changePasswordSchema.safeParse(body);
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    const { currentPassword, newPassword } = parseResult.data;
    const result = await authService.changePassword(currentPassword, newPassword);
    if (result.error) {
      return { status: 400, data: { ok: false, error: result.error } };
    }
    return { status: 200, data: { ok: true, message: "Password changed successfully" } };
  },

  /**
   * GET /api/auth/organisation/:id
   */
  async handleGetOrganisation(orgId: string) {
    const org = await organisationService.get(orgId);
    if (!org) {
      return { status: 404, data: { ok: false, error: "Organisation not found" } };
    }
    return { status: 200, data: { ok: true, organisation: org } };
  },

  /**
   * GET /api/auth/organisation/:id/members
   */
  async handleGetOrganisationMembers(orgId: string) {
    try {
      const members = await organisationService.getMembers(orgId);
      return { status: 200, data: { ok: true, members } };
    } catch (err: any) {
      return { status: 500, data: { ok: false, error: err.message || "Failed to fetch members" } };
    }
  },

  /**
   * POST /api/auth/organisation/:id/invite
   */
  async handleSendInvite(orgId: string, body: any) {
    const parseResult = inviteSchema.safeParse({ ...body, organisationId: orgId });
    if (!parseResult.success) {
      return { status: 400, data: { ok: false, error: getErrorMessage(parseResult.error) } };
    }
    try {
      const invite = await inviteService.send(orgId, parseResult.data.email, parseResult.data.role as any);
      return { status: 201, data: { ok: true, invite } };
    } catch (err: any) {
      return { status: 500, data: { ok: false, error: err.message || "Failed to send invite" } };
    }
  },
};
