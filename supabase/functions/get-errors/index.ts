// TaskFlow — Edge Function: get-errors
// GET /functions/v1/get-errors?limit=50&severity=error&resolved=false
// Returns recent errors from app_errors table (for dashboards, scripts, Make.com).
// Deploy: supabase functions deploy get-errors

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const severity = url.searchParams.get("severity");
    const resolved = url.searchParams.get("resolved");
    const source = url.searchParams.get("source");

    let query = supabase
      .from("app_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (severity) query = query.eq("severity", severity);
    if (resolved !== null && resolved !== undefined) {
      query = query.eq("resolved", resolved === "true");
    }
    if (source) query = query.eq("source", source);

    const { data, error } = await query;

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, count: data.length, errors: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
