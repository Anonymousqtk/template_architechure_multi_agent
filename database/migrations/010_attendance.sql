BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE work_shifts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  early_check_in integer NOT NULL CHECK (early_check_in BETWEEN 0 AND 720),
  late_grace integer CHECK (late_grace BETWEEN 0 AND 720),
  early_grace integer CHECK (early_grace BETWEEN 0 AND 720),
  overtime_after integer CHECK (overtime_after BETWEEN 0 AND 720),
  UNIQUE (id, organization_id),
  CHECK (start_time <> end_time)
);
CREATE UNIQUE INDEX work_shifts_name ON work_shifts (organization_id, lower(btrim(name)));

CREATE TABLE work_schedule (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  shift_id uuid,
  label text NOT NULL,
  work_date date NOT NULL,
  time_zone text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  early_check_in integer NOT NULL CHECK (early_check_in BETWEEN 0 AND 720),
  late_grace integer CHECK (late_grace BETWEEN 0 AND 720),
  early_grace integer CHECK (early_grace BETWEEN 0 AND 720),
  overtime_after integer CHECK (overtime_after BETWEEN 0 AND 720),
  UNIQUE (id, organization_id),
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  FOREIGN KEY (shift_id, organization_id) REFERENCES work_shifts(id, organization_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX work_schedule_tenant_date ON work_schedule (organization_id, work_date);
CREATE INDEX work_schedule_employee_window ON work_schedule (employee_id, starts_at, ends_at);

CREATE TABLE attendance_punches (
  schedule_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  checked_in_at timestamptz NOT NULL,
  checked_out_at timestamptz,
  FOREIGN KEY (schedule_id, organization_id) REFERENCES work_schedule(id, organization_id),
  CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at)
);

CREATE TABLE attendance_adjustments (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  proposed_in timestamptz NOT NULL,
  proposed_out timestamptz NOT NULL,
  observed_in timestamptz,
  observed_out timestamptz,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (schedule_id, organization_id) REFERENCES work_schedule(id, organization_id),
  CHECK (proposed_out > proposed_in),
  CHECK (reviewed_by IS DISTINCT FROM created_by),
  CHECK ((status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
         (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX attendance_adjustments_pending ON attendance_adjustments (schedule_id) WHERE status = 'PENDING';
CREATE INDEX attendance_adjustments_history ON attendance_adjustments (schedule_id, reviewed_at DESC) WHERE status = 'APPROVED';

CREATE TABLE leave_types (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  tracks_balance boolean NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX leave_types_name ON leave_types (organization_id, lower(btrim(name)));

CREATE TABLE leave_balances (
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  allowance_minutes integer NOT NULL CHECK (allowance_minutes >= 0),
  PRIMARY KEY (employee_id, leave_type_id),
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  FOREIGN KEY (leave_type_id, organization_id) REFERENCES leave_types(id, organization_id)
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  charge_minutes integer CHECK (charge_minutes >= 0),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_reason text,
  cancelled_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  FOREIGN KEY (leave_type_id, organization_id) REFERENCES leave_types(id, organization_id),
  CHECK (ends_at > starts_at),
  CHECK (reviewed_by IS DISTINCT FROM created_by),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CHECK (status <> 'APPROVED' OR (reviewed_by IS NOT NULL AND charge_minutes IS NOT NULL))
);
CREATE INDEX leave_requests_overlap ON leave_requests (employee_id, starts_at, ends_at) WHERE status IN ('PENDING','APPROVED');
CREATE INDEX leave_requests_balance ON leave_requests (employee_id, leave_type_id) WHERE status = 'APPROVED';

CREATE FUNCTION attendance_guard_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF TG_TABLE_NAME = 'work_schedule' THEN
    IF EXISTS (SELECT 1 FROM work_schedule s WHERE s.organization_id = NEW.organization_id AND s.employee_id = NEW.employee_id
      AND s.id <> NEW.id AND s.starts_at < NEW.ends_at AND s.ends_at > NEW.starts_at) THEN
      RAISE EXCEPTION 'Overlapping work schedules' USING ERRCODE = '23514', CONSTRAINT = 'work_schedule_overlap';
    END IF;
  ELSIF NEW.status IN ('PENDING','APPROVED') THEN
    IF EXISTS (SELECT 1 FROM leave_requests r WHERE r.organization_id = NEW.organization_id AND r.employee_id = NEW.employee_id
      AND r.id <> NEW.id AND r.status IN ('PENDING','APPROVED') AND r.starts_at < NEW.ends_at AND r.ends_at > NEW.starts_at) THEN
      RAISE EXCEPTION 'Overlapping leave requests' USING ERRCODE = '23514', CONSTRAINT = 'leave_requests_no_overlap';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER work_schedule_overlap_guard
  BEFORE INSERT OR UPDATE OF organization_id,employee_id,starts_at,ends_at ON work_schedule
  FOR EACH ROW EXECUTE FUNCTION attendance_guard_overlap();
CREATE TRIGGER leave_requests_overlap_guard
  BEFORE INSERT OR UPDATE OF organization_id,employee_id,starts_at,ends_at,status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION attendance_guard_overlap();

COMMIT;
