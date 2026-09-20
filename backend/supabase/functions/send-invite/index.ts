import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getAppBaseUrl } from "../_shared/domains.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Input validation schema
const InviteSchema = z.object({
  organisationId: z.string().uuid({ message: "Invalid organisation ID format" }),
  email: z.string()
    .email({ message: "Invalid email format" })
    .max(255, { message: "Email must be less than 255 characters" })
    .transform(s => s.toLowerCase().trim()),
  role: z.enum(["admin", "contributor", "user"], {
    errorMap: () => ({ message: "Role must be 'admin', 'contributor', or 'user'" })
  })
});

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validationResult = InviteSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      return new Response(
        JSON.stringify({ error: firstError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organisationId, email, role } = validationResult.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) {
      return new Response(
        JSON.stringify({ error: "Server not configured: missing service role key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerToken = authHeader.replace("Bearer ", "");
    const { data: { user: callerUser }, error: callerErr } = await supabaseAdmin.auth.getUser(callerToken);
    if (callerErr || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller role in organisation
    const { data: callerRole } = await supabaseAdmin
      .from("organisation_members")
      .select("role")
      .eq("user_id", callerUser.id)
      .eq("organisation_id", organisationId)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (!callerRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden: permission denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark any stale pending invite as expired
    await supabaseAdmin
      .from("organisation_invites")
      .update({ status: "expired" })
      .eq("organisation_id", organisationId)
      .eq("email", email)
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    // Create invite record in database
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("organisation_invites")
      .insert({
        organisation_id: organisationId,
        email,
        role,
      })
      .select()
      .single();

    if (inviteError) {
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get organisation name
    const { data: org } = await supabaseAdmin
      .from("organisations")
      .select("name")
      .eq("id", organisationId)
      .single();

    let inviterName: string | undefined = undefined;
    let inviterEmail: string | undefined = undefined;

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("first_name, last_name, email")
      .eq("user_id", callerUser.id)
      .single();

    if (profile) {
      inviterName = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
      inviterEmail = profile.email;
    }

    const baseUrl = getAppBaseUrl(req.headers.get("origin"));
    const acceptUrl = `${baseUrl}/accept-invite?token=${invite.token}`;

    const { error: emailError } = await supabaseAdmin.functions.invoke("send-custom-invite-email", {
      body: {
        email,
        organisationName: org?.name || "the organisation",
        role,
        inviterName,
        inviterEmail,
        acceptUrl,
      },
    });

    if (!emailError) {
      await supabaseAdmin
        .from("organisation_invites")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", invite.id);
    }

    return new Response(
      JSON.stringify({
        invite: {
          inviteId: invite.id,
          organisationId: invite.organisation_id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          token: invite.token,
          createdAt: invite.created_at,
          acceptedAt: invite.accepted_at,
        },
        emailSent: !emailError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
