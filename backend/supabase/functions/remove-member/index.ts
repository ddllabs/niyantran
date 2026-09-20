import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: { userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  if (!UUID.test(targetUserId)) return json({ error: "invalid_user_id" }, 400);

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: auth } = await anon.auth.getUser();
  const callerId = auth?.user?.id;
  if (!callerId) return json({ error: "unauthorized" }, 401);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: caller } = await service
    .from("user_profiles")
    .select("organisation_id, status")
    .eq("user_id", callerId)
    .maybeSingle();

  if (!caller?.organisation_id || caller.status !== "active") {
    return json({ error: "forbidden" }, 403);
  }

  const { data: callerRole } = await service
    .from("organisation_members")
    .select("role")
    .eq("user_id", callerId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!callerRole || !["owner", "admin"].includes(String(callerRole.role))) {
    return json({ error: "forbidden" }, 403);
  }
  if (callerId === targetUserId) return json({ error: "cannot_remove_self" }, 400);

  // Soft-remove from organisation
  const { error: profileError } = await service
    .from("user_profiles")
    .update({ status: "inactive", organisation_id: null })
    .eq("user_id", targetUserId);

  if (profileError) {
    return json({ error: profileError.message || "Failed to remove member" }, 400);
  }

  await service
    .from("organisation_members")
    .update({ status: "disabled" })
    .eq("user_id", targetUserId)
    .eq("organisation_id", caller.organisation_id);

  return json({ ok: true, removedUserId: targetUserId });
});
