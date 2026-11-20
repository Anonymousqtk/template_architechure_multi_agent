BEGIN;
SET LOCAL lock_timeout = '5s';

-- ============================================================
-- PAY-001 Enhancement: Salary & Social Insurance History
-- Migration 016 — Additive only. No existing tables altered.
-- ============================================================

-- 1. Employee Social Insurance Profile
--    One active record per employee; temporal via effective_from/to.
CREATE TABLE employee_social_insurance (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL,
  employee_id          uuid NOT NULL,
  si_code              text NOT NULL,          -- Mã số BHXH (do BHXH VN cấp)
  hi_code              text,                   -- Mã BHYT (nếu khác)
  insured_name         text NOT NULL,          -- Tên theo hồ sơ BHXH
  enrollment_date      date NOT NULL,          -- Ngày tham gia
  termination_date     date,                   -- Ngày kết thúc (nếu có)
  si_salary            numeric(15,2) NOT NULL DEFAULT 0.00 CHECK (si_salary >= 0),
  -- Mức lương đóng BHXH (thường là lương hợp đồng, không phải thực nhận)
  currency             text NOT NULL DEFAULT 'VND',
  status               text NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  suspension_reason    text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, organization_id)
    REFERENCES employees(id, organization_id),
  UNIQUE (id, organization_id),
  CHECK (termination_date IS NULL OR termination_date >= enrollment_date)
);
CREATE UNIQUE INDEX emp_si_active_one
  ON employee_social_insurance (organization_id, employee_id)
  WHERE status = 'ACTIVE';
CREATE INDEX emp_si_emp ON employee_social_insurance (organization_id, employee_id, enrollment_date DESC);

-- 2. Social Insurance Monthly Contribution History
--    One row per employee per contribution month. Immutable once confirmed.
CREATE TABLE social_insurance_contributions (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL,
  si_profile_id        uuid NOT NULL,
  employee_id          uuid NOT NULL,
  contribution_month   date NOT NULL,          -- First day of month (e.g. 2026-01-01)
  si_salary            numeric(15,2) NOT NULL CHECK (si_salary >= 0),
  employee_rate        numeric(5,4) NOT NULL DEFAULT 0.0000 CHECK (employee_rate >= 0 AND employee_rate <= 1),
  employer_rate        numeric(5,4) NOT NULL DEFAULT 0.0000 CHECK (employer_rate >= 0 AND employer_rate <= 1),
  employee_amount      numeric(15,2) NOT NULL DEFAULT 0.00 CHECK (employee_amount >= 0),
  employer_amount      numeric(15,2) NOT NULL DEFAULT 0.00 CHECK (employer_amount >= 0),
  status               text NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','CONFIRMED','ADJUSTED','SKIPPED')),
  adjustment_reason    text,
  confirmed_by         uuid REFERENCES users(id),
  confirmed_at         timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (si_profile_id, organization_id)
    REFERENCES employee_social_insurance(id, organization_id),
  FOREIGN KEY (employee_id, organization_id)
    REFERENCES employees(id, organization_id),
  UNIQUE (si_profile_id, contribution_month),
  UNIQUE (organization_id, employee_id, contribution_month)
);
CREATE INDEX si_contributions_emp ON social_insurance_contributions
  (organization_id, employee_id, contribution_month DESC);
CREATE INDEX si_contributions_month ON social_insurance_contributions
  (organization_id, contribution_month DESC);

-- 3. Salary Adjustment Log
--    Append-only audit log recording every salary profile save.
--    Does NOT store actual amounts — only metadata for traceability.
CREATE TABLE salary_adjustment_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  employee_id          uuid NOT NULL,
  salary_profile_id    uuid NOT NULL,
  action               text NOT NULL CHECK (action IN ('CREATED','UPDATED','DEACTIVATED')),
  effective_from       date NOT NULL,
  effective_to         date,
  salary_mode          text NOT NULL CHECK (salary_mode IN ('GROSS','NET')),
  currency             text NOT NULL DEFAULT 'VND',
  actor_user_id        uuid NOT NULL REFERENCES users(id),
  reason               text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, organization_id)
    REFERENCES employees(id, organization_id)
);
CREATE INDEX salary_adj_log_emp ON salary_adjustment_log
  (organization_id, employee_id, recorded_at DESC);

-- 4. Trigger: auto-populate salary_adjustment_log on INSERT to employee_salary_profiles
CREATE OR REPLACE FUNCTION trg_salary_profile_audit_log()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  audit_actor uuid;
BEGIN
  audit_actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  IF audit_actor IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'salary profile insert requires app.current_user_id';
  END IF;

  INSERT INTO salary_adjustment_log(
    id, organization_id, employee_id, salary_profile_id,
    action, effective_from, effective_to, salary_mode, currency,
    actor_user_id, reason, recorded_at
  ) VALUES (
    gen_random_uuid(),
    NEW.organization_id,
    NEW.employee_id,
    NEW.id,
    'CREATED',
    NEW.effective_from,
    NEW.effective_to,
    NEW.salary_mode,
    NEW.currency,
    audit_actor,
    NULL,
    now()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_salary_profile_created
AFTER INSERT ON employee_salary_profiles
FOR EACH ROW EXECUTE FUNCTION trg_salary_profile_audit_log();

COMMIT;

