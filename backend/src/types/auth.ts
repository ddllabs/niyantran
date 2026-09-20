// Authoritative Niyantran AI Authentication and Organization Schema Types

export type AppRole = "user" | "admin" | "owner" | "contributor";
export type UserRole = AppRole;

export type AppPersona = 
  | "policy_analyst"
  | "journalist"
  | "upsc_aspirant"
  | "corporate_affairs"
  | "legal_researcher"
  | "academic";

export type UserPersona = AppPersona;

export const USER_PERSONAS = [
  { value: "policy_analyst", label: "Policy Analyst" },
  { value: "journalist", label: "Journalist" },
  { value: "upsc_aspirant", label: "UPSC Aspirant" },
  { value: "corporate_affairs", label: "Corporate Affairs" },
  { value: "legal_researcher", label: "Legal Researcher" },
  { value: "academic", label: "Academic" },
] as const;

export type AppPlan = "explorer" | "professional" | "enterprise";
export type UserPlan = AppPlan;

export type AccountStatus = "active" | "inactive" | "suspended";
export type UserStatus = AccountStatus;

export type MemberStatus = "active" | "invited" | "disabled";
export type MembershipStatus = MemberStatus;

export type OrganisationType = "enterprise" | "academic" | "government" | "startup" | "individual" | "other";
export type OrganisationStatus = "active" | "inactive" | "pending";

export const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Research",
  "Operations",
  "Legal",
  "Finance",
  "Procurement",
  "Management",
  "Other",
] as const;

export const JOB_TITLES = [
  "Researcher",
  "Data Analyst",
  "Product Manager",
  "Software Engineer",
  "Executive",
  "Procurement Specialist",
  "Consultant",
  "Other",
] as const;

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Organisation {
  id: string;
  name: string;
  website?: string | null;
  logoUrl?: string | null;
  about?: string | null;
  industryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id?: string;
  userId: string;
  organisationId?: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phoneE164?: string | null;
  phoneVerified?: boolean;
  phoneVerifiedAt?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  persona?: AppPersona | null;
  practiceArea?: string | null;
  jurisdiction?: string | null;
  language?: string;
  role: AppRole;
  plan: AppPlan;
  status: AccountStatus;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationMember {
  id: string;
  organisationId: string;
  userId: string;
  role: AppRole;
  status: MemberStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleMapping {
  id: string;
  userId: string;
  organisationId?: string | null;
  role: AppRole;
  createdAt: string;
}

export interface OrganisationInvite {
  id?: string;
  inviteId?: string;
  organisationId: string;
  email: string;
  role: AppRole;
  status: InviteStatus;
  token?: string;
  emailSentAt?: string | null;
  expiresAt?: string;
  createdAt: string;
  acceptedAt?: string | null;
}

export interface PrivacyPolicyConsent {
  id: string;
  userId: string;
  policyVersion: string;
  acceptedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  organisationId?: string;
  onboardingComplete?: boolean;
}
