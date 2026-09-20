import { supabase } from "../integrations/supabase/client";
import { OrganisationInvite, UserRole } from "../types/auth";

export const inviteService = {
  /**
   * Send an organization invite to an email address
   */
  send: async (
    organisationId: string,
    email: string,
    role: "admin" | "contributor"
  ): Promise<OrganisationInvite> => {
    try {
      const { data, error } = await supabase.functions.invoke("send-invite", {
        body: { organisationId, email, role },
      });
      if (!error && data) {
        const inviteData = data.invite || data;
        return {
          inviteId: inviteData.inviteId || inviteData.id,
          organisationId: inviteData.organisationId || organisationId,
          email: inviteData.email || email,
          role: inviteData.role || role,
          status: inviteData.status || "pending",
          token: inviteData.token,
          createdAt: inviteData.createdAt || new Date().toISOString(),
          acceptedAt: inviteData.acceptedAt,
        };
      }
    } catch {
      // Fallback to direct DB insert
    }

    const { data: invite, error: inviteError } = await supabase
      .from("organisation_invites")
      .insert({ organisation_id: organisationId, email, role })
      .select()
      .single();

    if (inviteError) throw new Error(inviteError.message || "Failed to create invite");

    return {
      inviteId: invite.id,
      organisationId: invite.organisation_id,
      email: invite.email,
      role: invite.role as Exclude<UserRole, "owner">,
      status: invite.status as "pending" | "accepted" | "revoked" | "expired",
      token: invite.token as string,
      createdAt: invite.created_at,
      acceptedAt: invite.accepted_at ?? undefined,
    };
  },

  /**
   * Get all invites for an organisation
   */
  getByOrganisation: async (organisationId: string): Promise<OrganisationInvite[]> => {
    const { data, error } = await supabase
      .from("organisation_invites")
      .select("*")
      .eq("organisation_id", organisationId);

    if (error || !data) return [];

    return data.map((invite: any) => ({
      inviteId: invite.id || invite.invite_id,
      organisationId: invite.organisation_id,
      email: invite.email,
      role: invite.role as Exclude<UserRole, "owner">,
      status: invite.status as "pending" | "accepted" | "revoked" | "expired",
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
      acceptedAt: invite.accepted_at,
      timesSent: 1,
      lastSentAt: invite.created_at,
    }));
  },

  /**
   * Resend an existing invite
   */
  resend: async (inviteId: string): Promise<void> => {
    const { error } = await supabase.functions.invoke("send-custom-invite-email", {
      body: { inviteId },
    });
    if (error) throw new Error("Failed to send invitation email");
  },

  /**
   * Revoke an invite
   */
  revoke: async (inviteId: string): Promise<void> => {
    await supabase
      .from("organisation_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId);
  },

  /**
   * Get pending invites for currently logged in user email
   */
  getPendingForCurrentUser: async (): Promise<OrganisationInvite[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return [];

    const { data, error } = await supabase
      .from("organisation_invites")
      .select("*")
      .eq("email", user.email)
      .eq("status", "pending");

    if (error || !data) return [];

    return data.map((invite: any) => ({
      inviteId: invite.id,
      organisationId: invite.organisation_id,
      email: invite.email,
      role: invite.role as Exclude<UserRole, "owner">,
      status: invite.status as "pending" | "accepted" | "revoked" | "expired",
      createdAt: invite.created_at,
      acceptedAt: invite.accepted_at,
    }));
  },
};
