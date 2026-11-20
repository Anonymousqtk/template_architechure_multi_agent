BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE system_administrators (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- No automatic grants. Initial provisioning requires an explicit human designation and audit event.
COMMIT;
