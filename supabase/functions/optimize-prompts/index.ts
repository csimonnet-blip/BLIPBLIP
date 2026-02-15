// TaskFlow — Edge Function: optimize-prompts
// Triggered by pg_cron (hourly) or manually via POST.
// Fetches pending prompts, optimizes them via Gemini, updates the table.
//
// POST /functions/v1/optimize-prompts
// Body: { "triggered_by": "pg_cron" | "manual", "batch_size": 10 }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Model-specific optimization guidelines ──────────────────
const MODEL_GUIDELINES: Record<string, string> = {
  claude: `Optimisation pour Claude (Anthropic):
- Utiliser des instructions structurées avec des balises XML (<instructions>, <context>, <output_format>)
- Être explicite sur le format de sortie attendu
- Placer le contexte important au début du prompt
- Utiliser "Think step by step" pour les raisonnements complexes
- Éviter les négations, préférer les formulations positives
- Tirer parti du system prompt pour le rôle et les contraintes
- Claude excelle avec les prompts longs et détaillés — ne pas hésiter à être exhaustif`,

  openai: `Optimisation pour GPT (OpenAI):
- Utiliser le format system/user message de manière optimale
- Donner des exemples few-shot quand possible
- Être concis mais précis — GPT performe mieux avec des prompts plus courts et ciblés
- Utiliser le JSON mode ou function calling pour les sorties structurées
- Spécifier explicitement "Do not" pour les contraintes
- Utiliser des délimiteurs clairs (### ou """) pour séparer sections
- GPT-4 gère bien les instructions multi-étapes numérotées`,

  google: `Optimisation pour Gemini (Google):
- Structurer avec des sections claires et des titres
- Utiliser des exemples concrets pour guider le format
- Gemini est fort en multimodal — mentionner si des images/documents sont impliqués
- Préférer les instructions directes et simples
- Utiliser des listes à puces pour les contraintes multiples`,

  mistral: `Optimisation pour Mistral:
- Garder les prompts concis et directs
- Mistral excelle avec les instructions système claires
- Utiliser le format [INST] pour les instructions critiques
- Moins verbeux que Claude — aller droit au but
- Fort en code et en raisonnement logique`,

  meta: `Optimisation pour LLaMA (Meta):
- Prompts concis et structurés
- Utiliser des balises spéciales [INST] [/INST] pour les instructions
- Moins de contexte = meilleur focus
- Donner des exemples courts mais représentatifs
- Éviter les prompts trop longs qui diluent l'attention`,

  other: `Optimisation générale:
- Structurer clairement avec rôle, contexte, tâche, format
- Donner des exemples du résultat attendu
- Être explicite sur les contraintes
- Utiliser des instructions étape par étape`,
};

// ── Build the meta-prompt for optimization ──────────────────
function buildOptimizationPrompt(
  original: string,
  label: string,
  modelFamily: string,
  category: string | null,
  tags: string[] | null
): string {
  const guidelines =
    MODEL_GUIDELINES[modelFamily] || MODEL_GUIDELINES["other"];

  return `Tu es un expert en prompt engineering. Ton rôle est d'optimiser des prompts IA pour les rendre plus efficaces.

<context>
- Label du prompt: "${label}"
- Catégorie: ${category || "non spécifiée"}
- Tags: ${tags?.join(", ") || "aucun"}
- Famille de modèle cible: ${modelFamily}
</context>

<model_guidelines>
${guidelines}
</model_guidelines>

<original_prompt>
${original}
</original_prompt>

<instructions>
1. Analyse le prompt original: identifie les faiblesses (vague, mal structuré, manque de contexte, format non optimal pour le modèle cible)
2. Réécris le prompt en appliquant les guidelines spécifiques au modèle cible
3. Attribue un score de 1-10 au prompt original et au prompt optimisé
4. Explique brièvement ce qui a été amélioré

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "optimized": "Le prompt réécrit et optimisé",
  "score_before": 5,
  "score_after": 8,
  "notes": "Résumé des améliorations en 1-2 phrases"
}
</instructions>`;
}

// ── Call Gemini to optimize ─────────────────────────────────
type OptimizationResult = {
  optimized: string;
  score_before: number;
  score_after: number;
  notes: string;
};

async function callGemini(prompt: string): Promise<OptimizationResult | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Parse JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.optimized) return null;

  return {
    optimized: parsed.optimized,
    score_before: Math.min(10, Math.max(1, Number(parsed.score_before) || 5)),
    score_after: Math.min(10, Math.max(1, Number(parsed.score_after) || 7)),
    notes: parsed.notes || "Optimisation effectuée",
  };
}

// ── Log errors to app_errors table ──────────────────────────
async function logError(
  supabase: ReturnType<typeof createClient>,
  message: string,
  details: Record<string, unknown>
) {
  await supabase.from("app_errors").insert({
    source: "optimize-prompts",
    severity: "error",
    message,
    details,
  });
}

// ── Main handler ────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse request
    let batchSize = 10;
    let triggeredBy = "manual";
    try {
      const body = await req.json();
      batchSize = body.batch_size || 10;
      triggeredBy = body.triggered_by || "manual";
    } catch {
      // No body or invalid JSON — use defaults
    }

    // Fetch pending prompts (oldest first, max batch_size)
    const { data: pendingPrompts, error: fetchError } = await supabase
      .from("ai_prompts")
      .select("*")
      .eq("status", "pending")
      .eq("is_active", true)
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (fetchError) {
      await logError(supabase, "Failed to fetch pending prompts", {
        error: fetchError.message,
      });
      return new Response(
        JSON.stringify({ ok: false, error: fetchError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!pendingPrompts || pendingPrompts.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "No pending prompts to optimize",
          processed: 0,
          triggered_by: triggeredBy,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Process each prompt
    const results: {
      id: number;
      label: string;
      status: string;
      score_before?: number;
      score_after?: number;
    }[] = [];

    for (const prompt of pendingPrompts) {
      // Mark as optimizing
      await supabase
        .from("ai_prompts")
        .update({ status: "optimizing", last_attempt: new Date().toISOString() })
        .eq("id", prompt.id);

      try {
        const metaPrompt = buildOptimizationPrompt(
          prompt.original,
          prompt.label,
          prompt.model_family || "other",
          prompt.category,
          prompt.tags
        );

        const result = await callGemini(metaPrompt);

        if (result) {
          await supabase
            .from("ai_prompts")
            .update({
              optimized: result.optimized,
              score_before: result.score_before,
              score_after: result.score_after,
              optimization_notes: result.notes,
              status: "optimized",
              attempts: prompt.attempts + 1,
            })
            .eq("id", prompt.id);

          // Send email notification to the prompt owner
          if (prompt.user_id) {
            try {
              await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-prompt-email`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({ prompt_id: prompt.id }),
                }
              );
            } catch {
              // Email failure should not block the optimization flow
            }
          }

          results.push({
            id: prompt.id,
            label: prompt.label,
            status: "optimized",
            score_before: result.score_before,
            score_after: result.score_after,
          });
        } else {
          await supabase
            .from("ai_prompts")
            .update({
              status: "failed",
              attempts: prompt.attempts + 1,
              optimization_notes:
                "GEMINI_API_KEY not configured or failed to parse Gemini response",
            })
            .eq("id", prompt.id);

          results.push({
            id: prompt.id,
            label: prompt.label,
            status: "failed",
          });
        }
      } catch (err) {
        const errorMessage = (err as Error).message;

        const newStatus = prompt.attempts + 1 >= 3 ? "failed" : "pending";
        await supabase
          .from("ai_prompts")
          .update({
            status: newStatus,
            attempts: prompt.attempts + 1,
            optimization_notes: `Attempt ${prompt.attempts + 1} failed: ${errorMessage}`,
          })
          .eq("id", prompt.id);

        await logError(supabase, `Optimization failed for prompt #${prompt.id}`, {
          prompt_id: prompt.id,
          label: prompt.label,
          attempt: prompt.attempts + 1,
          error: errorMessage,
        });

        results.push({
          id: prompt.id,
          label: prompt.label,
          status: newStatus,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const optimizedCount = results.filter((r) => r.status === "optimized").length;

    return new Response(
      JSON.stringify({
        ok: true,
        triggered_by: triggeredBy,
        processed: results.length,
        optimized: optimizedCount,
        failed: results.length - optimizedCount,
        duration_ms: durationMs,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
