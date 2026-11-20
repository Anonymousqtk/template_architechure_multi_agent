-- EMP-003: Employee Profile Enhancement, Documents & Batch Import
BEGIN;
SET LOCAL lock_timeout='5s';

-- 1. Avatar support for employee profile
ALTER TABLE employees ADD COLUMN avatar_url text;

-- 2. Enhanced work history events: appointments, awards, transfers, promotions
ALTER TABLE employee_work_history ADD COLUMN event_type text NOT NULL DEFAULT 'TRANSFER'
  CHECK(event_type IN ('PROFILE_CREATED','ASSIGNMENT_CHANGED','TRANSFER','APPOINTMENT','PROMOTION','AWARD','DISCIPLINE','SALARY_ADJUSTMENT','OTHER'));
ALTER TABLE employee_work_history ADD COLUMN title text;
ALTER TABLE employee_work_history ADD COLUMN notes text;

-- Guard: Work history records are permanent audit records and cannot be deleted
CREATE FUNCTION guard_immutable_work_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Work history records are permanent and cannot be deleted' USING ERRCODE='23514';
END $$;
CREATE TRIGGER guard_work_history_delete BEFORE DELETE ON employee_work_history FOR EACH ROW EXECUTE FUNCTION guard_immutable_work_history();

-- 3. Employee documents management with strict MIME and type constraints
CREATE TABLE employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL CHECK(file_size > 0),
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv')),
  document_type text NOT NULL DEFAULT 'OTHER' CHECK(document_type IN ('IDENTIFICATION','DEGREE_CERTIFICATE','LABOR_CONTRACT','DECISION','RESUME','OTHER')),
  description text,
  uploaded_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, organization_id),
  FOREIGN KEY(employee_id, organization_id) REFERENCES employees(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(uploaded_by_user_id, organization_id) REFERENCES memberships(user_id, organization_id)
);

CREATE INDEX employee_documents_org_emp ON employee_documents(organization_id, employee_id, created_at DESC);

COMMIT;
