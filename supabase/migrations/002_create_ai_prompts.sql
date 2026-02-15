-- ============================================================
-- Migration 002: AI Prompts table + pg_cron optimizer
-- TaskFlow — Automated prompt optimization system
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- Table: ai_prompts
-- Stores all AI prompts used across the system, their
-- optimized versions, and metadata about the target model.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_prompts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who owns this prompt
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_label    TEXT,                              -- human-readable label ("Simon", "Make.com", "system")

  -- The prompt itself
  label         TEXT NOT NULL,                     -- short name ("task-creation", "error-summary", "daily-report")
  original      TEXT NOT NULL,                     -- the raw prompt as written
  optimized     TEXT,                              -- AI-improved version (filled by cron)

  -- Model context
  target_model  TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',  -- which model this prompt targets
  model_family  TEXT GENERATED ALWAYS AS (
    CASE
      WHEN target_model ILIKE '%claude%'  THEN 'claude'
      WHEN target_model ILIKE '%gpt%'     THEN 'openai'
      WHEN target_model ILIKE '%gemini%'  THEN 'google'
      WHEN target_model ILIKE '%mistral%' THEN 'mistral'
      WHEN target_model ILIKE '%llama%'   THEN 'meta'
      ELSE 'other'
    END
  ) STORED,

  -- Optimization tracking
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'optimizing', 'optimized', 'failed', 'skipped')),
  optimization_notes TEXT,                         -- explanation of what was improved
  score_before  SMALLINT CHECK (score_before BETWEEN 1 AND 10),
  score_after   SMALLINT CHECK (score_after  BETWEEN 1 AND 10),
  attempts      SMALLINT NOT NULL DEFAULT 0,       -- how many times optimization was tried
  last_attempt  TIMESTAMPTZ,

  -- Source & context
  source        TEXT NOT NULL DEFAULT 'manual',    -- 'manual', 'lovable-app', 'make.com', 'edge-function'
  category      TEXT,                              -- 'system-prompt', 'user-query', 'automation', 'agent-instruction'
  tags          TEXT[],                            -- free-form tags for filtering
  is_active     BOOLEAN NOT NULL DEFAULT true,     -- soft delete / archive

  -- Usage stats (updated by the app)
  usage_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ
);

-- Indexes for fast queries
CREATE INDEX idx_ai_prompts_status      ON public.ai_prompts (status) WHERE status = 'pending';
CREATE INDEX idx_ai_prompts_model       ON public.ai_prompts (target_model);
CREATE INDEX idx_ai_prompts_user        ON public.ai_prompts (user_id);
CREATE INDEX idx_ai_prompts_label       ON public.ai_prompts (label);
CREATE INDEX idx_ai_prompts_active      ON public.ai_prompts (is_active, status);
CREATE INDEX idx_ai_prompts_created     ON public.ai_prompts (created_at DESC);

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION update_ai_prompts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_prompts_updated
  BEFORE UPDATE ON public.ai_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_prompts_timestamp();

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions, cron): full access
CREATE POLICY "service_role_full_access" ON public.ai_prompts
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users: can insert and read their own prompts
CREATE POLICY "users_insert_own" ON public.ai_prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_read_own" ON public.ai_prompts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_update_own" ON public.ai_prompts
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- pg_cron: Schedule optimize-prompts every hour
-- Calls the Edge Function via pg_net
-- ============================================================
SELECT cron.schedule(
  'optimize-prompts-hourly',
  '0 * * * *',   -- every hour at minute 0
  $$
  SELECT net.http_post(
    url    := 'https://ysosafbecisjvrxgigat.supabase.co/functions/v1/optimize-prompts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body   := '{"triggered_by": "pg_cron", "batch_size": 10}'::jsonb
  );
  $$
);
