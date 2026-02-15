// TaskFlow — Edge Function: process-travel-email
// Webhook called by Make.com when a "travel" label is added to an email.
// Uses Gemini 3 Pro to extract travel info, then creates or updates a voyage.
//
// POST /functions/v1/process-travel-email
// Body (from Make.com):
// {
//   "email_subject": "Confirmation de vol AF1234",
//   "email_body": "...",
//   "email_from": "noreply@airfrance.com",
//   "email_date": "2026-02-15T10:00:00Z",
//   "user_id": "optional-uuid"
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Gemini: extract travel info from email ──────────────────
type TravelExtraction = {
  title: string;
  destination: string;
  origin: string | null;
  departure_date: string | null;
  return_date: string | null;
  transport_type: string | null;
  carrier: string | null;
  booking_ref: string | null;
  flight_number: string | null;
  hotel_name: string | null;
  hotel_address: string | null;
  hotel_checkin: string | null;
  hotel_checkout: string | null;
  hotel_booking_ref: string | null;
  total_cost: number | null;
  currency: string | null;
  stops: string[] | null;
  confidence: number;
  notes: string;
  action: "create" | "update";
  match_booking_ref: string | null;
};

async function extractTravelInfo(
  subject: string,
  body: string,
  from: string
): Promise<TravelExtraction | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const prompt = `Tu es un assistant specialise dans l'extraction d'informations de voyage a partir d'emails.

<email>
De: ${from}
Objet: ${subject}

${body}
</email>

<instructions>
Analyse cet email et extrais TOUTES les informations de voyage possibles.
Determine aussi si cet email concerne un NOUVEAU voyage ou une MISE A JOUR d'un voyage existant (modification, annulation, rappel).

Reponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "title": "Titre court du voyage (ex: 'Vol Paris-Tokyo', 'Hotel Marriott Barcelone')",
  "destination": "Ville ou aeroport de destination",
  "origin": "Ville ou aeroport de depart (null si inconnu)",
  "departure_date": "YYYY-MM-DD (null si inconnu)",
  "return_date": "YYYY-MM-DD (null si inconnu)",
  "transport_type": "flight|train|bus|car|ferry|other (null si pas de transport)",
  "carrier": "Compagnie (Air France, SNCF, etc.) (null si inconnu)",
  "booking_ref": "Reference de reservation (null si absente)",
  "flight_number": "Numero de vol (null si pas un vol)",
  "hotel_name": "Nom de l'hotel (null si pas d'hotel)",
  "hotel_address": "Adresse de l'hotel (null si inconnu)",
  "hotel_checkin": "YYYY-MM-DD (null si inconnu)",
  "hotel_checkout": "YYYY-MM-DD (null si inconnu)",
  "hotel_booking_ref": "Reference reservation hotel (null si absente)",
  "total_cost": 123.45,
  "currency": "EUR|USD|GBP|... (null si inconnu)",
  "stops": ["escale1", "escale2"],
  "confidence": 8,
  "notes": "Resume en 1 phrase de ce que contient l'email",
  "action": "create ou update",
  "match_booking_ref": "Si action=update, la reference de reservation a chercher pour matcher le voyage existant (null si create)"
}
</instructions>`;

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

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.title || !parsed.destination) return null;

  return {
    title: parsed.title,
    destination: parsed.destination,
    origin: parsed.origin || null,
    departure_date: parsed.departure_date || null,
    return_date: parsed.return_date || null,
    transport_type: parsed.transport_type || null,
    carrier: parsed.carrier || null,
    booking_ref: parsed.booking_ref || null,
    flight_number: parsed.flight_number || null,
    hotel_name: parsed.hotel_name || null,
    hotel_address: parsed.hotel_address || null,
    hotel_checkin: parsed.hotel_checkin || null,
    hotel_checkout: parsed.hotel_checkout || null,
    hotel_booking_ref: parsed.hotel_booking_ref || null,
    total_cost: parsed.total_cost ? Number(parsed.total_cost) : null,
    currency: parsed.currency || null,
    stops: parsed.stops || null,
    confidence: Math.min(10, Math.max(1, Number(parsed.confidence) || 5)),
    notes: parsed.notes || "",
    action: parsed.action === "update" ? "update" : "create",
    match_booking_ref: parsed.match_booking_ref || null,
  };
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
    const {
      email_subject,
      email_body,
      email_from,
      email_date,
      user_id,
    } = body;

    if (!email_subject && !email_body) {
      return new Response(
        JSON.stringify({ ok: false, error: "email_subject or email_body is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract travel info via Gemini
    const extraction = await extractTravelInfo(
      email_subject || "",
      email_body || "",
      email_from || "unknown"
    );

    if (!extraction) {
      // Log the failure
      await supabase.from("app_errors").insert({
        source: "process-travel-email",
        severity: "warning",
        message: "Could not extract travel info from email",
        details: { email_subject, email_from },
      });

      return new Response(
        JSON.stringify({ ok: false, error: "Could not extract travel information from email" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the voyage record
    const voyageData = {
      user_id: user_id || null,
      title: extraction.title,
      status: extraction.departure_date ? "confirmed" : "draft",
      destination: extraction.destination,
      origin: extraction.origin,
      departure_date: extraction.departure_date,
      return_date: extraction.return_date,
      transport_type: extraction.transport_type,
      carrier: extraction.carrier,
      booking_ref: extraction.booking_ref,
      flight_number: extraction.flight_number,
      hotel_name: extraction.hotel_name,
      hotel_address: extraction.hotel_address,
      hotel_checkin: extraction.hotel_checkin,
      hotel_checkout: extraction.hotel_checkout,
      hotel_booking_ref: extraction.hotel_booking_ref,
      total_cost: extraction.total_cost,
      currency: extraction.currency || "EUR",
      stops: extraction.stops,
      raw_email_subject: email_subject,
      raw_email_body: email_body,
      raw_email_from: email_from,
      email_received_at: email_date || new Date().toISOString(),
      extraction_confidence: extraction.confidence,
      extraction_notes: extraction.notes,
      source: "make.com" as const,
    };

    let result;
    let action = "created";

    // Try to update existing voyage if action=update and we have a booking ref
    if (extraction.action === "update" && extraction.match_booking_ref) {
      const { data: existing } = await supabase
        .from("voyages")
        .select("id")
        .eq("booking_ref", extraction.match_booking_ref)
        .limit(1)
        .single();

      if (existing) {
        // Update existing voyage — merge non-null fields
        const updateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(voyageData)) {
          if (value !== null && value !== undefined) {
            updateData[key] = value;
          }
        }

        const { data, error } = await supabase
          .from("voyages")
          .update(updateData)
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw new Error(`Update failed: ${error.message}`);
        result = data;
        action = "updated";
      }
    }

    // Create new voyage if not updated
    if (!result) {
      const { data, error } = await supabase
        .from("voyages")
        .insert(voyageData)
        .select()
        .single();

      if (error) throw new Error(`Insert failed: ${error.message}`);
      result = data;
      action = "created";
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action,
        voyage_id: result.id,
        title: result.title,
        destination: result.destination,
        departure_date: result.departure_date,
        confidence: extraction.confidence,
        notes: extraction.notes,
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
