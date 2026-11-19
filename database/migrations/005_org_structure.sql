-- ORG-001 organization structure, departments, positions and reporting schema migration.
-- Forward-only, transactional, preserving existing AUTH-001 through AUTH-004 rows.
BEGIN;

-- 1. Extend organizations with code, hierarchy, description
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS description text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_no_self_parent'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_no_self_parent
      CHECK (parent_organization_id IS NULL OR parent_organization_id <> id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_idx
  ON organizations(lower(btrim(code)))
  WHERE code IS NOT NULL;

-- 2. Departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  manager_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT departments_org_code_unique UNIQUE (organization_id, code),
  CONSTRAINT departments_manager_membership_fkey FOREIGN KEY (manager_user_id, organization_id)
    REFERENCES memberships(user_id, organization_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS departments_org_idx ON departments(organization_id, is_active);
CREATE INDEX IF NOT EXISTS departments_parent_idx ON departments(organization_id, parent_id);

-- 3. Positions table
CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT positions_org_code_unique UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS positions_org_idx ON positions(organization_id, is_active);
CREATE INDEX IF NOT EXISTS positions_dept_idx ON positions(organization_id, department_id);

-- 4. Extend memberships with department and position references
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES positions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS memberships_org_dept_idx
  ON memberships(organization_id, department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS memberships_org_pos_idx
  ON memberships(organization_id, position_id)
  WHERE position_id IS NOT NULL;

COMMIT;
