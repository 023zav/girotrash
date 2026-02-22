-- GiroTrash: Initial Database Schema
-- Supabase Postgres migration

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE report_status AS ENUM (
  'pending_review',
  'approved_sending',
  'sent',
  'replied',
  'rejected',
  'deleted'
);

-- =============================================================================
-- TABLES
-- =============================================================================

-- Reports table
CREATE TABLE reports (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz     NOT NULL DEFAULT now(),
  status              report_status   NOT NULL DEFAULT 'pending_review',
  lat                 double precision NOT NULL,
  lon                 double precision NOT NULL,
  distance_to_girona_m int           NOT NULL,
  inside_service_area boolean         NOT NULL,
  address_label       text            NULL,
  description         text            NULL,
  potentially_hazardous boolean       NOT NULL DEFAULT false,
  email_lang          text            NOT NULL DEFAULT 'ca'
                      CHECK (email_lang IN ('ca', 'es', 'en')),
  email_subject       text            NULL,
  resend_message_id   text            NULL,
  sent_at             timestamptz     NULL,
  admin_override      boolean         NOT NULL DEFAULT false,
  user_device_id      text            NULL,
  ip_hash             text            NULL,
  last_error          text            NULL,
  honeypot            text            NULL,
  CONSTRAINT valid_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT valid_lon CHECK (lon BETWEEN -180 AND 180)
);

-- Report media table
CREATE TABLE report_media (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id           uuid            NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  storage_path        text            NOT NULL,
  mime_type           text            NOT NULL,
  compressed_bytes    int             NOT NULL,
  width               int             NOT NULL,
  height              int             NOT NULL,
  created_at          timestamptz     NOT NULL DEFAULT now()
);

-- Geocode cache table (for reverse-geocode edge function)
CREATE TABLE geocode_cache (
  rounded_lat         double precision NOT NULL,
  rounded_lon         double precision NOT NULL,
  address_label       text            NOT NULL,
  updated_at          timestamptz     NOT NULL DEFAULT now(),
  PRIMARY KEY (rounded_lat, rounded_lon)
);

-- Admin users allowlist (simple email-based)
CREATE TABLE admin_users (
  email               text            PRIMARY KEY,
  created_at          timestamptz     NOT NULL DEFAULT now()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_reports_status_created
  ON reports (status, created_at DESC);

CREATE INDEX idx_reports_distance
  ON reports (distance_to_girona_m);

CREATE INDEX idx_report_media_report_id
  ON report_media (report_id);

CREATE INDEX idx_geocode_cache_updated
  ON geocode_cache (updated_at);

-- =============================================================================
-- STORAGE
-- =============================================================================

-- Create private bucket for report media
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-media', 'report-media', false)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- REPORTS: No anonymous access. All inserts via Edge Functions (service role).
-- Admin: full access.
-- ---------------------------------------------------------------------------

-- Admin can do everything on reports
CREATE POLICY "admin_full_reports"
  ON reports
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  );

-- ---------------------------------------------------------------------------
-- REPORT_MEDIA: Same pattern — no anon access, admin full.
-- ---------------------------------------------------------------------------

CREATE POLICY "admin_full_report_media"
  ON report_media
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  );

-- ---------------------------------------------------------------------------
-- GEOCODE_CACHE: Readable by anyone (used by edge function via service role,
-- but allow anon read for potential client-side use). Write via service role.
-- ---------------------------------------------------------------------------

CREATE POLICY "anyone_read_geocode_cache"
  ON geocode_cache
  FOR SELECT
  USING (true);

CREATE POLICY "service_write_geocode_cache"
  ON geocode_cache
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- ADMIN_USERS: Only service role can read/write.
-- ---------------------------------------------------------------------------

CREATE POLICY "service_only_admin_users"
  ON admin_users
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
  );

-- Admin can read their own entry (to verify they are admin)
CREATE POLICY "admin_read_self"
  ON admin_users
  FOR SELECT
  USING (
    email = (SELECT auth.jwt() ->> 'email')
  );

-- ---------------------------------------------------------------------------
-- STORAGE POLICIES: report-media bucket
-- ---------------------------------------------------------------------------

-- Admin can read all objects in report-media
CREATE POLICY "admin_read_report_media"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'report-media'
    AND EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  );

-- Service role can insert/update/delete (used by edge functions)
-- Note: service_role bypasses RLS, so this is implicit.
-- These policies ensure anon cannot upload directly.
CREATE POLICY "deny_anon_upload_report_media"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id != 'report-media'
    OR (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = (SELECT auth.jwt() ->> 'email')
    )
  );

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to check if a user is admin (used in edge functions)
CREATE OR REPLACE FUNCTION is_admin(user_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE email = user_email
  );
$$;

-- Function to calculate distance from Girona center (Haversine)
CREATE OR REPLACE FUNCTION distance_to_girona(p_lat double precision, p_lon double precision)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(
    6371000 * acos(
      LEAST(1.0,
        cos(radians(41.9794)) * cos(radians(p_lat)) *
        cos(radians(p_lon) - radians(2.8214)) +
        sin(radians(41.9794)) * sin(radians(p_lat))
      )
    )
  )::integer;
$$;
