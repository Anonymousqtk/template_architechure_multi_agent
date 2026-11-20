BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Salary Components (Cấu phần lương, phụ cấp, thưởng, khấu trừ)
CREATE TABLE salary_components (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('BASE_SALARY', 'ALLOWANCE', 'BONUS', 'DEDUCTION')),
  calculation_type text NOT NULL DEFAULT 'FIXED' CHECK (calculation_type IN ('FIXED', 'PERCENTAGE', 'ATTENDANCE_BASED', 'FORMULA')),
  is_taxable boolean NOT NULL DEFAULT true,
  is_statutory boolean NOT NULL DEFAULT false,
  default_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (default_amount >= 0),
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX salary_components_org_code ON salary_components (organization_id, upper(btrim(code)));
CREATE INDEX salary_components_org_type ON salary_components (organization_id, type);

-- 2. Employee Salary Profiles (Mức lương cơ bản, Gross/Net, hiệu lực theo thời gian)
CREATE TABLE employee_salary_profiles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  salary_mode text NOT NULL DEFAULT 'GROSS' CHECK (salary_mode IN ('GROSS', 'NET')),
  base_salary numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (base_salary >= 0),
  effective_from date NOT NULL,
  effective_to date,
  currency text NOT NULL DEFAULT 'VND',
  bank_account_number text,
  bank_name text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  UNIQUE (id, organization_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employee_salary_profiles_emp ON employee_salary_profiles (organization_id, employee_id, effective_from DESC);

-- 3. Employee Recurring Salary Profile Components (Phụ cấp, khấu trừ gắn với profile)
CREATE TABLE employee_salary_profile_components (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  component_id uuid NOT NULL,
  amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
  percentage numeric(5, 2) CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profile_id, organization_id) REFERENCES employee_salary_profiles(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (component_id, organization_id) REFERENCES salary_components(id, organization_id),
  UNIQUE (profile_id, component_id)
);

-- 4. Payroll Periods (Kỳ lương: DRAFT -> UNDER_REVIEW -> APPROVED -> CLOSED)
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  payment_date date,
  standard_working_days numeric(5, 2) NOT NULL DEFAULT 22.00 CHECK (standard_working_days > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'CLOSED')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX payroll_periods_org_code ON payroll_periods (organization_id, upper(btrim(code)));
CREATE INDEX payroll_periods_dates ON payroll_periods (organization_id, start_date DESC, end_date DESC);

-- 5. Payroll Slips (Bảng lương / phiếu lương nhân viên trong kỳ)
CREATE TABLE payroll_slips (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  salary_mode text NOT NULL DEFAULT 'GROSS' CHECK (salary_mode IN ('GROSS', 'NET')),
  standard_days numeric(5, 2) NOT NULL DEFAULT 22.00 CHECK (standard_days > 0),
  actual_working_days numeric(5, 2) NOT NULL DEFAULT 0.00 CHECK (actual_working_days >= 0),
  paid_leave_days numeric(5, 2) NOT NULL DEFAULT 0.00 CHECK (paid_leave_days >= 0),
  unpaid_leave_days numeric(5, 2) NOT NULL DEFAULT 0.00 CHECK (unpaid_leave_days >= 0),
  overtime_hours numeric(6, 2) NOT NULL DEFAULT 0.00 CHECK (overtime_hours >= 0),
  base_salary numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (base_salary >= 0),
  prorated_base_salary numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (prorated_base_salary >= 0),
  total_allowances numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_allowances >= 0),
  total_bonuses numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_bonuses >= 0),
  total_deductions numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_deductions >= 0),
  overtime_pay numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (overtime_pay >= 0),
  gross_pay numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (gross_pay >= 0),
  net_pay numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (net_pay >= 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  UNIQUE (id, organization_id),
  UNIQUE (period_id, employee_id)
);
CREATE INDEX payroll_slips_employee ON payroll_slips (organization_id, employee_id, created_at DESC);

-- 6. Payroll Slip Items (Chi tiết từng khoản mục trong phiếu lương)
CREATE TABLE payroll_slip_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  slip_id uuid NOT NULL,
  component_id uuid,
  component_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('BASE_SALARY', 'ALLOWANCE', 'BONUS', 'DEDUCTION', 'OVERTIME', 'OTHER')),
  amount numeric(15, 2) NOT NULL CHECK (amount >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (slip_id, organization_id) REFERENCES payroll_slips(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (component_id, organization_id) REFERENCES salary_components(id, organization_id)
);
CREATE INDEX payroll_slip_items_slip ON payroll_slip_items (slip_id);

-- 7. Immutability Trigger for CLOSED Payroll Periods
CREATE OR REPLACE FUNCTION guard_closed_payroll_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_period_status text;
  v_period_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'payroll_periods' THEN
    IF OLD.status = 'CLOSED' AND (NEW.status <> 'CLOSED' OR NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date OR NEW.standard_working_days <> OLD.standard_working_days) THEN
      RAISE EXCEPTION 'cannot modify a closed payroll period';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'payroll_slips' THEN
    v_period_id := COALESCE(OLD.period_id, NEW.period_id);
    SELECT status INTO v_period_status FROM payroll_periods WHERE id = v_period_id;
    IF v_period_status = 'CLOSED' THEN
      RAISE EXCEPTION 'cannot modify slips in a closed payroll period';
    END IF;
    RETURN COALESCE(NEW, OLD);
  ELSIF TG_TABLE_NAME = 'payroll_slip_items' THEN
    SELECT p.status INTO v_period_status
    FROM payroll_slips s
    JOIN payroll_periods p ON p.id = s.period_id
    WHERE s.id = COALESCE(OLD.slip_id, NEW.slip_id);
    IF v_period_status = 'CLOSED' THEN
      RAISE EXCEPTION 'cannot modify slip items in a closed payroll period';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_closed_payroll_period
BEFORE UPDATE OR DELETE ON payroll_periods
FOR EACH ROW EXECUTE FUNCTION guard_closed_payroll_period();

CREATE TRIGGER trg_guard_closed_payroll_slips
BEFORE INSERT OR UPDATE OR DELETE ON payroll_slips
FOR EACH ROW EXECUTE FUNCTION guard_closed_payroll_period();

CREATE TRIGGER trg_guard_closed_payroll_slip_items
BEFORE INSERT OR UPDATE OR DELETE ON payroll_slip_items
FOR EACH ROW EXECUTE FUNCTION guard_closed_payroll_period();

COMMIT;
