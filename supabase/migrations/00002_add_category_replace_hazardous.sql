-- Migration: Replace potentially_hazardous with category, rename resend_message_id to fcc_incident_id
-- Part of FCC API integration (replaces email-based reporting)

-- Add category column
ALTER TABLE reports ADD COLUMN category text NULL CHECK (category IN ('waste', 'litter'));

-- Migrate existing data: hazardous → waste, non-hazardous → litter
UPDATE reports SET category = CASE WHEN potentially_hazardous THEN 'waste' ELSE 'litter' END;

-- Make category NOT NULL after migration
ALTER TABLE reports ALTER COLUMN category SET NOT NULL;

-- Drop old column
ALTER TABLE reports DROP COLUMN potentially_hazardous;

-- Rename resend_message_id to fcc_incident_id
ALTER TABLE reports RENAME COLUMN resend_message_id TO fcc_incident_id;

-- Drop email_subject (no longer needed — we submit to API, not email)
ALTER TABLE reports DROP COLUMN email_subject;

-- Add reply tracking columns for FCC email responses
ALTER TABLE reports ADD COLUMN reply_text text NULL;
ALTER TABLE reports ADD COLUMN reply_from text NULL;
ALTER TABLE reports ADD COLUMN replied_at timestamptz NULL;

-- Index for feedback tab (replied reports sorted by reply date)
CREATE INDEX idx_reports_replied_at ON reports (replied_at DESC) WHERE replied_at IS NOT NULL;
