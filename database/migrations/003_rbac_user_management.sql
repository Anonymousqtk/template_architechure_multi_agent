-- AUTH-002 organization-scoped RBAC and user management schema migration.
-- Forward-only, transactional, preserving existing AUTH-001 rows.
BEGIN;

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('EMPLOYEE', 'HR', 'MANAGER', 'ADMIN'));

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS manager_user_id uuid;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_manager_membership_fkey
  FOREIGN KEY (manager_user_id, organization_id)
  REFERENCES memberships(user_id, organization_id);

ALTER TABLE memberships
  ADD CONSTRAINT memberships_no_self_manager_check
  CHECK (manager_user_id IS NULL OR manager_user_id <> user_id);

CREATE INDEX IF NOT EXISTS memberships_org_manager_idx
  ON memberships(organization_id, manager_user_id)
  WHERE manager_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_audit_events_org_created_idx
  ON auth_audit_events(organization_id, created_at DESC, id);

COMMIT;
