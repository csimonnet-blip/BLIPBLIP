// TaskFlow — Edge Function: send-prompt-email
// Sends an email to the prompt owner with original + optimized version.
//
// POST /functions/v1/send-prompt-email
// Body: { "prompt_id": 1 }                → single prompt, auto-resolve user email
//   OR: { "prompt_id": 1, "to_email": "override@test.com" }  → explicit email
//   OR: { "user_id": "uuid" }             → all optimized prompts for the user

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Resolve user email from auth.users ──────────────────────
async function resolveEmail(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

// ── Build HTML email ────────────────────────────────────────
function buildEmailHtml(
  prompts: { label: string; original: string; optimized: string; score_before: number; score_after: number; optimization_notes: string }[]
): string {
  const promptBlocks = prompts
    .map(
      (p) => `
    <div style="margin-bottom:32px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#1e293b;color:#fff;padding:16px 20px">
        <h2 style="margin:0;font-size:18px">${escapeHtml(p.label)}</h2>
        <span style="font-size:13px;opacity:0.8">Score : ${p.score_before}/10 → ${p.score_after}/10</span>
      </div>

      <div style="padding:20px">
        <h3 style="color:#ef4444;margin:0 0 8px">Ancien prompt</h3>
        <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:13px;line-height:1.5">${escapeHtml(p.original)}</pre>

        <h3 style="color:#22c55e;margin:20px 0 8px">Prompt optimise</h3>
        <pre style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:13px;line-height:1.5">${escapeHtml(p.optimized)}</pre>

        <p style="margin:16px 0 0;padding:12px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569">
          <strong>Notes :</strong> ${escapeHtml(p.optimization_notes)}
        </p>
      </div>
    </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:32px 16px">
  <div style="max-width:640px;margin:0 auto">
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="font-size:24px;color:#0f172a;margin:0 0 8px">TaskFlow — Resultats d'optimisation</h1>
      <p style="color:#64748b;margin:0">${prompts.length} prompt(s) optimise(s) par Gemini 3 Pro</p>
    </div>
    ${promptBlocks}
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:32px">
      Envoye automatiquement par TaskFlow - Prompt Optimizer
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Send email via Resend ───────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("RESEND_API_KEY not configured");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "TaskFlow <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend API error ${resp.status}: ${err}`);
  }

  return await resp.json();
}

// ── Main handler ────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { prompt_id, to_email, user_id } = body;

    // Fetch prompts: single by id OR all optimized for a user
    let query = supabase
      .from("ai_prompts")
      .select("id, label, original, optimized, score_before, score_after, optimization_notes, user_id")
      .eq("status", "optimized");

    if (prompt_id) {
      query = query.eq("id", prompt_id);
    } else if (user_id) {
      query = query.eq("user_id", user_id);
    }

    const { data: prompts, error } = await query;

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!prompts || prompts.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "No optimized prompts found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve email: use explicit to_email, or look up from auth.users
    let recipientEmail = to_email;
    if (!recipientEmail) {
      const ownerUserId = user_id || prompts[0].user_id;
      if (!ownerUserId) {
        return new Response(
          JSON.stringify({ ok: false, error: "No user_id on prompt — provide to_email explicitly" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      recipientEmail = await resolveEmail(supabase, ownerUserId);
      if (!recipientEmail) {
        return new Response(
          JSON.stringify({ ok: false, error: `Could not resolve email for user ${ownerUserId}` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const subject = prompts.length === 1
      ? `Prompt optimise : ${prompts[0].label}`
      : `${prompts.length} prompts optimises — TaskFlow`;

    const html = buildEmailHtml(prompts);
    const emailResult = await sendEmail(recipientEmail, subject, html);

    return new Response(
      JSON.stringify({
        ok: true,
        email_id: emailResult.id,
        to: recipientEmail,
        prompts_sent: prompts.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
