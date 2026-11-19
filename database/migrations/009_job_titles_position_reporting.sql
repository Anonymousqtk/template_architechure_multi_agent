BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE job_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,30}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  description text CHECK (char_length(description) <= 500),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, code)
);

ALTER TABLE positions
  ADD COLUMN job_title_id uuid,
  ADD COLUMN manager_position_id uuid,
  ADD CONSTRAINT positions_job_title_tenant_fk
    FOREIGN KEY (job_title_id, organization_id) REFERENCES job_titles(id, organization_id),
  ADD CONSTRAINT positions_manager_tenant_fk
    FOREIGN KEY (manager_position_id, organization_id) REFERENCES positions(id, organization_id),
  ADD CONSTRAINT positions_no_self_manager CHECK (id <> manager_position_id);

CREATE INDEX positions_job_title_idx ON positions (organization_id, job_title_id);
CREATE INDEX positions_manager_idx ON positions (organization_id, manager_position_id);

CREATE FUNCTION guard_position_reporting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF EXISTS (
    WITH RECURSIVE ancestors(id, manager_id) AS (
      SELECT id, manager_position_id FROM positions
      WHERE organization_id = NEW.organization_id AND id = NEW.manager_position_id
      UNION
      SELECT p.id, p.manager_position_id FROM positions p
      JOIN ancestors a ON p.id = a.manager_id WHERE p.organization_id = NEW.organization_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id OR manager_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Circular position reporting' USING ERRCODE = '23514', CONSTRAINT = 'positions_reporting_cycle';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER positions_reporting_guard
  BEFORE INSERT OR UPDATE OF manager_position_id, organization_id ON positions
  FOR EACH ROW EXECUTE FUNCTION guard_position_reporting();

COMMIT;
