-- PostgreSQL initial AUTH-001 schema proposal. Review against the actual ORM/framework before applying.
-- Do not execute on production as part of agent work. This migration has not been applied.
BEGIN;
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text NOT NULL, full_name text NOT NULL,
  password_hash text NOT NULL, email_verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower_check CHECK (email = lower(btrim(email)))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email);
CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  role text NOT NULL CHECK (role IN ('EMPLOYEE','HR','ADMIN')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships(organization_id);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL, role text NOT NULL CHECK (role IN ('EMPLOYEE','HR')),
  token_hash char(64) NOT NULL UNIQUE,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_lower_check CHECK (email = lower(btrim(email)))
);
CREATE INDEX IF NOT EXISTS invitations_org_created_idx ON invitations(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS invitations_pending_email_idx ON invitations(organization_id,email) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  token_hash char(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id);
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  session_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_audit_events (
  id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id), event_type text NOT NULL,
  subject_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMIT;
