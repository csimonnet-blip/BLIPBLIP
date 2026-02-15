-- ============================================================
-- Migration 003 : Voyages — travel tracking from email labels
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voyages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Owner
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Trip identity
  title           TEXT NOT NULL,                           -- "Paris → Tokyo", "Week-end Lisbonne"
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'confirmed', 'in_progress', 'completed', 'cancelled')),

  -- Dates
  departure_date  DATE,
  return_date     DATE,

  -- Locations
  origin          TEXT,                                    -- "Paris CDG"
  destination     TEXT NOT NULL,                           -- "Tokyo NRT"
  stops           TEXT[],                                  -- layovers / multi-city

  -- Transport
  transport_type  TEXT CHECK (transport_type IN ('flight', 'train', 'bus', 'car', 'ferry', 'other')),
  carrier         TEXT,                                    -- "Air France", "SNCF"
  booking_ref     TEXT,                                    -- confirmation code
  flight_number   TEXT,

  -- Accommodation
  hotel_name      TEXT,
  hotel_address   TEXT,
  hotel_checkin   DATE,
  hotel_checkout  DATE,
  hotel_booking_ref TEXT,

  -- Financial
  total_cost      NUMERIC(10, 2),
  currency        TEXT DEFAULT 'EUR',

  -- Raw data from email
  raw_email_subject TEXT,
  raw_email_body    TEXT,
  raw_email_from    TEXT,
  email_received_at TIMESTAMPTZ,

  -- AI extraction metadata
  extracted_by    TEXT DEFAULT 'gemini-3-pro-preview',
  extraction_confidence SMALLINT CHECK (extraction_confidence BETWEEN 1 AND 10),
  extraction_notes TEXT,

  -- Source
  source          TEXT NOT NULL DEFAULT 'email'
                  CHECK (source IN ('email', 'manual', 'make.com', 'api')),

  -- Tags & notes
  tags            TEXT[],
  notes           TEXT
);

-- Indexes
CREATE INDEX idx_voyages_user      ON public.voyages (user_id);
CREATE INDEX idx_voyages_status    ON public.voyages (status);
CREATE INDEX idx_voyages_departure ON public.voyages (departure_date);
CREATE INDEX idx_voyages_dest      ON public.voyages (destination);
CREATE INDEX idx_voyages_booking   ON public.voyages (booking_ref);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_voyages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_voyages_updated
  BEFORE UPDATE ON public.voyages
  FOR EACH ROW EXECUTE FUNCTION update_voyages_timestamp();

-- RLS
ALTER TABLE public.voyages ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY voyages_service_all ON public.voyages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: own voyages
CREATE POLICY voyages_user_read ON public.voyages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY voyages_user_insert ON public.voyages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY voyages_user_update ON public.voyages
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
