-- Additional AUTH-001 controls. Apply after 001, on an approved target only.
BEGIN;
ALTER TABLE user_sessions ADD COLUMN organization_id uuid NOT NULL REFERENCES organizations(id);
ALTER TABLE invitations ADD COLUMN delivery_status text NOT NULL DEFAULT 'DEV_ONLY'
  CHECK (delivery_status IN ('DEV_ONLY', 'SENT', 'FAILED'));
CREATE TABLE auth_rate_limits (
  key_hash char(64) PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX user_sessions_org_idx ON user_sessions(organization_id);
COMMIT;
