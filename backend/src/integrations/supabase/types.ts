export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      organisations: {
        Row: {
          about: string | null
          created_at: string
          id: string
          industry_id: string | null
          logo_url: string | null
          name: string
          updated_at: string
          website: string | null
        }
        Insert: {
          about?: string | null
          created_at?: string
          id?: string
          industry_id?: string | null
          logo_url?: string | null
          name: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          about?: string | null
          created_at?: string
          id?: string
          industry_id?: string | null
          logo_url?: string | null
          name?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          department: string | null
          email: string
          first_name: string | null
          id: string
          job_title: string | null
          jurisdiction: string | null
          language: string
          last_name: string | null
          onboarding_complete: boolean
          organisation_id: string | null
          persona: Database["public"]["Enums"]["app_persona"] | null
          phone_e164: string | null
          phone_verified: boolean
          phone_verified_at: string | null
          plan: Database["public"]["Enums"]["app_plan"]
          practice_area: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          email: string
          first_name?: string | null
          id?: string
          job_title?: string | null
          jurisdiction?: string | null
          language?: string
          last_name?: string | null
          onboarding_complete?: boolean
          organisation_id?: string | null
          persona?: Database["public"]["Enums"]["app_persona"] | null
          phone_e164?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          plan?: Database["public"]["Enums"]["app_plan"]
          practice_area?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string
          first_name?: string | null
          id?: string
          job_title?: string | null
          jurisdiction?: string | null
          language?: string
          last_name?: string | null
          onboarding_complete?: boolean
          organisation_id?: string | null
          persona?: Database["public"]["Enums"]["app_persona"] | null
          phone_e164?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          plan?: Database["public"]["Enums"]["app_plan"]
          practice_area?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          }
        ]
      }
      organisation_members: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          }
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          }
        ]
      }
      organisation_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          email_sent_at: string | null
          expires_at: string
          id: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          organisation_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_invites_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          }
        ]
      }
      privacy_policy_consents: {
        Row: {
          accepted_at: string
          id: string
          ip_address: string | null
          policy_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          ip_address?: string | null
          policy_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          ip_address?: string | null
          policy_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_profile: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Tables"]["user_profiles"]["Row"]
      }
      update_my_onboarding_profile: {
        Args: {
          p_persona?: Database["public"]["Enums"]["app_persona"] | null
          p_practice_area?: string | null
          p_jurisdiction?: string | null
          p_language?: string
          p_onboarding_complete?: boolean
        }
        Returns: Database["public"]["Tables"]["user_profiles"]["Row"]
      }
      create_organisation: {
        Args: {
          p_name: string
          p_website?: string | null
          p_about?: string | null
          p_industry_id?: string | null
        }
        Returns: Database["public"]["Tables"]["organisations"]["Row"]
      }
      is_platform_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_org_member: {
        Args: {
          p_organisation_id: string
        }
        Returns: boolean
      }
      is_org_owner: {
        Args: {
          p_organisation_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "admin" | "owner"
      app_persona: "policy_analyst" | "journalist" | "upsc_aspirant" | "corporate_affairs" | "legal_researcher" | "academic"
      app_plan: "explorer" | "professional" | "enterprise"
      account_status: "active" | "inactive" | "suspended"
      member_status: "active" | "invited" | "disabled"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
