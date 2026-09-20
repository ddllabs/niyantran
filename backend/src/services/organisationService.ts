import { supabase } from "../integrations/supabase/client";
import { Organisation, UserProfile, AppRole } from "../types/auth";

export const organisationService = {
  /**
   * Create a new organisation and assign the creating user as owner
   */
  create: async (data: Omit<Organisation, "id" | "createdAt" | "updatedAt">): Promise<Organisation> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Try create_organisation RPC from schema
    try {
      const { data: rpcOrg, error: rpcError } = await (supabase.rpc as any)("create_organisation", {
        p_name: data.name,
        p_website: data.website || null,
        p_about: data.about || null,
        p_industry_id: data.industryId || null,
      });
      if (!rpcError && rpcOrg) {
        return {
          id: rpcOrg.id,
          name: rpcOrg.name,
          website: rpcOrg.website,
          logoUrl: rpcOrg.logo_url,
          about: rpcOrg.about,
          industryId: rpcOrg.industry_id,
          createdAt: rpcOrg.created_at,
          updatedAt: rpcOrg.updated_at,
        };
      }
    } catch {
      // Fall through to direct table insert
    }

    // Direct table insert into organisations
    const { data: org, error: orgError } = await supabase
      .from("organisations")
      .insert({
        name: data.name,
        website: data.website || null,
        logo_url: data.logoUrl || null,
        about: data.about || null,
      })
      .select()
      .single();

    if (orgError || !org) throw orgError || new Error("Failed to create organisation");

    // Insert owner into organisation_members
    await supabase
      .from("organisation_members")
      .insert({
        organisation_id: org.id,
        user_id: user.id,
        role: "owner",
        status: "active",
      });

    // Update user_profiles organisation_id
    await supabase
      .from("user_profiles")
      .update({ organisation_id: org.id })
      .eq("user_id", user.id);

    return {
      id: org.id,
      name: org.name,
      website: org.website,
      logoUrl: org.logo_url,
      about: org.about,
      industryId: org.industry_id,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
    };
  },

  /**
   * Get organisation details by ID
   */
  get: async (organisationId: string): Promise<Organisation | null> => {
    const { data, error } = await supabase
      .from("organisations")
      .select("*")
      .eq("id", organisationId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      name: data.name,
      website: data.website,
      logoUrl: data.logo_url,
      about: data.about,
      industryId: data.industry_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  /**
   * Update organisation settings
   */
  update: async (organisationId: string, data: Partial<Organisation>): Promise<Organisation> => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.website !== undefined) updateData.website = data.website;
    if (data.logoUrl !== undefined) updateData.logo_url = data.logoUrl;
    if (data.about !== undefined) updateData.about = data.about;

    const { data: org, error } = await supabase
      .from("organisations")
      .update(updateData)
      .eq("id", organisationId)
      .select("*")
      .single();

    if (error) throw error;

    return {
      id: org.id,
      name: org.name,
      website: org.website,
      logoUrl: org.logo_url,
      about: org.about,
      industryId: org.industry_id,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
    };
  },

  /**
   * Get all members belonging to an organisation
   */
  getMembers: async (organisationId: string): Promise<UserProfile[]> => {
    // 1. Query organisation_members
    const { data: members, error: membersError } = await supabase
      .from("organisation_members")
      .select("*")
      .eq("organisation_id", organisationId);

    if (membersError) {
      // Fallback to user_profiles if organisation_members is not yet populated
      const { data: profiles, error: profilesError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("organisation_id", organisationId);

      if (profilesError) throw profilesError;

      return (profiles || []).map((p: any) => ({
        userId: p.user_id,
        organisationId: p.organisation_id,
        email: p.email,
        firstName: p.first_name,
        lastName: p.last_name,
        role: (p.role as AppRole) || "contributor",
        status: (p.status as "active" | "inactive") || "active",
        onboardingComplete: p.onboarding_complete ?? false,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));
    }

    if (!members || members.length === 0) return [];

    // 2. Fetch corresponding profiles
    const userIds = members.map((m: any) => m.user_id);
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("user_id", userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    return members.map((m: any) => {
      const p = profileMap.get(m.user_id) || ({} as any);
      return {
        userId: m.user_id,
        organisationId: m.organisation_id,
        email: p.email || "",
        firstName: p.first_name,
        lastName: p.last_name,
        phoneE164: p.phone_e164,
        department: p.department,
        jobTitle: p.job_title,
        role: (m.role as AppRole) || "contributor",
        status: (m.status as "active" | "inactive") || "active",
        onboardingComplete: p.onboarding_complete ?? false,
        createdAt: m.created_at || p.created_at,
        updatedAt: m.updated_at || p.updated_at,
      };
    });
  },

  /**
   * Update member role in organisation
   */
  updateMemberRole: async (userId: string, organisationId: string, role: "admin" | "contributor"): Promise<void> => {
    const { error: memberError } = await supabase
      .from("organisation_members")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("organisation_id", organisationId);

    if (memberError) {
      const { error: rpcError } = await (supabase.rpc as any)("update_member_role", {
        p_target_user_id: userId,
        p_organisation_id: organisationId,
        p_new_role: role,
      });
      if (rpcError) throw new Error(rpcError.message || "Failed to update role");
    }
  },

  /**
   * Deactivate or remove a member
   */
  deactivateMember: async (userId: string): Promise<void> => {
    try {
      const { error } = await supabase.functions.invoke("remove-member", {
        body: { userId },
      });
      if (!error) return;
    } catch {
      // Fall through
    }

    // Direct fallback
    await supabase
      .from("organisation_members")
      .update({ status: "disabled", updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  },

  /**
   * Transfer organisation ownership
   */
  transferOwnership: async (currentOwnerId: string, newOwnerId: string, organisationId: string): Promise<void> => {
    await supabase
      .from("organisation_members")
      .update({ role: "admin", updated_at: new Date().toISOString() })
      .eq("user_id", currentOwnerId)
      .eq("organisation_id", organisationId);

    await supabase
      .from("organisation_members")
      .update({ role: "owner", updated_at: new Date().toISOString() })
      .eq("user_id", newOwnerId)
      .eq("organisation_id", organisationId);
  },

  /**
   * Fetch full user profile
   */
  getUserProfile: async (userId: string): Promise<UserProfile | null> => {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError || !profile) return null;

    let role: AppRole = "user";
    let orgId = profile.organisation_id;

    const { data: member } = await supabase
      .from("organisation_members")
      .select("role, organisation_id, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (member) {
      if (member.role) role = member.role as AppRole;
      if (member.organisation_id) orgId = member.organisation_id;
    } else if (profile.role) {
      role = profile.role as AppRole;
    }

    return {
      userId: profile.user_id,
      organisationId: orgId,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phoneE164: profile.phone_e164,
      phoneVerified: profile.phone_verified ?? undefined,
      phoneVerifiedAt: profile.phone_verified_at ?? undefined,
      department: profile.department,
      jobTitle: profile.job_title,
      role,
      persona: (profile.persona as any) ?? null,
      plan: (profile.plan as any) ?? null,
      status: (profile.status as "active" | "inactive") || "active",
      onboardingComplete: profile.onboarding_complete ?? false,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
  },

  /**
   * Mark user onboarding as complete
   */
  markOnboardingComplete: async (): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("user_profiles")
      .update({ onboarding_complete: true, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
  },

  /**
   * Get authenticated user's own profile via get_my_profile() RPC
   */
  getMyProfile: async (): Promise<UserProfile | null> => {
    const { data, error } = await (supabase.rpc as any)("get_my_profile");
    if (error || !data) return null;
    return {
      id: data.id,
      userId: data.user_id,
      organisationId: data.organisation_id,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      phoneE164: data.phone_e164,
      phoneVerified: data.phone_verified,
      phoneVerifiedAt: data.phone_verified_at,
      department: data.department,
      jobTitle: data.job_title,
      persona: data.persona,
      practiceArea: data.practice_area,
      jurisdiction: data.jurisdiction,
      language: data.language,
      role: data.role,
      plan: data.plan,
      status: data.status,
      onboardingComplete: data.onboarding_complete,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  /**
   * Update authenticated user's onboarding profile via update_my_onboarding_profile() RPC
   */
  updateMyOnboardingProfile: async (payload: {
    persona?: any;
    practiceArea?: string;
    jurisdiction?: string;
    language?: string;
    onboardingComplete?: boolean;
  }): Promise<UserProfile | null> => {
    const { data, error } = await (supabase.rpc as any)("update_my_onboarding_profile", {
      p_persona: payload.persona || null,
      p_practice_area: payload.practiceArea || null,
      p_jurisdiction: payload.jurisdiction || null,
      p_language: payload.language || "en",
      p_onboarding_complete: payload.onboardingComplete ?? true,
    });
    if (error || !data) throw error || new Error("Failed to update onboarding profile");
    return {
      id: data.id,
      userId: data.user_id,
      organisationId: data.organisation_id,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      phoneE164: data.phone_e164,
      phoneVerified: data.phone_verified,
      phoneVerifiedAt: data.phone_verified_at,
      department: data.department,
      jobTitle: data.job_title,
      persona: data.persona,
      practiceArea: data.practice_area,
      jurisdiction: data.jurisdiction,
      language: data.language,
      role: data.role,
      plan: data.plan,
      status: data.status,
      onboardingComplete: data.onboarding_complete,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },
};
