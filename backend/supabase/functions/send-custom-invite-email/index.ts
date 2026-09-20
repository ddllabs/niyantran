import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { isTrustedUrl } from "../_shared/domains.ts";
import { corsHeaders } from "../_shared/cors.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const InviteEmailSchema = z.object({
  email: z.string()
    .email({ message: "Invalid email format" })
    .max(255, { message: "Email must be less than 255 characters" })
    .transform(s => s.toLowerCase().trim()),
  organisationName: z.string()
    .min(1, { message: "Organisation name is required" })
    .max(100, { message: "Organisation name must be less than 100 characters" }),
  role: z.string(),
  inviterName: z.string().optional(),
  inviterEmail: z.string().optional(),
  acceptUrl: z.string().url({ message: "Accept URL must be a valid URL" }),
});

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validationResult = InviteEmailSchema.safeParse(body);

    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: validationResult.error.errors[0]?.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, organisationName, role, inviterName, inviterEmail, acceptUrl } = validationResult.data;

    const safeOrgName = escapeHtml(organisationName);
    const safeInviter = inviterName ? escapeHtml(inviterName) : (inviterEmail ? escapeHtml(inviterEmail) : "A team administrator");
    const safeRole = escapeHtml(role);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invitation to join ${safeOrgName}</title>
</head>
<body style="font-family: sans-serif; background-color: #f9f9f9; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px;">
    <h2>Join ${safeOrgName} on Niyantran</h2>
    <p>Hi,</p>
    <p><strong>${safeInviter}</strong> has invited you to join <strong>${safeOrgName}</strong> as a <strong>${safeRole}</strong>.</p>
    <p style="margin: 30px 0;">
      <a href="${acceptUrl}" style="background-color: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        Accept Invitation
      </a>
    </p>
    <p style="color: #666; font-size: 13px;">If the button above does not work, visit this link directly:<br>${acceptUrl}</p>
  </div>
</body>
</html>
    `;

    const fromAddress = Deno.env.get("RESEND_FROM_EMAIL") || "Niyantran <noreply@niyantran.ai>";

    const emailResponse = await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject: `You're invited to join ${safeOrgName}`,
      html,
    });

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
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
