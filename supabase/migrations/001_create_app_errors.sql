-- TaskFlow / SimoTask — Centralized Error Tracking
-- This table captures all application errors independently from Lovable.
-- Errors can be inserted from: Edge Functions, client-side JS, Make.com webhooks.

CREATE TABLE IF NOT EXISTS app_errors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'unknown',   -- e.g. 'client', 'edge-function', 'make.com', 'supabase-trigger'
  severity      TEXT NOT NULL DEFAULT 'error',     -- 'info', 'warning', 'error', 'critical'
  message       TEXT NOT NULL,
  details       JSONB,                             -- stack trace, request payload, context
  user_id       UUID REFERENCES auth.users(id),    -- optional: which user hit this error
  resolved      BOOLEAN NOT NULL DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  notes         TEXT                               -- manual notes when triaging
);

-- Index for quick dashboard queries
CREATE INDEX idx_app_errors_created_at ON app_errors (created_at DESC);
CREATE INDEX idx_app_errors_source     ON app_errors (source);
CREATE INDEX idx_app_errors_severity   ON app_errors (severity);
CREATE INDEX idx_app_errors_resolved   ON app_errors (resolved);

-- Row-Level Security: only service_role and authenticated admins can read/write
ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions, server-side) can do everything
CREATE POLICY "service_role_full_access" ON app_errors
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow any authenticated user to INSERT (client-side error reporting)
CREATE POLICY "authenticated_insert" ON app_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to SELECT their own errors (optional)
CREATE POLICY "authenticated_read_own" ON app_errors
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
