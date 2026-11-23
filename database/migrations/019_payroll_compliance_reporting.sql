BEGIN;
SET LOCAL lock_timeout = '5s';

-- ============================================================
-- PAY-004: Payroll Compliance & Reporting
-- Migration 019 — Additive only.
-- ============================================================

-- 1. Statutory Compliance Rules (Quy tắc thuế, bảo hiểm, lương tối thiểu theo ngày hiệu lực)
CREATE TABLE compliance_statutory_rules (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  rule_type text NOT NULL CHECK (rule_type IN ('PIT_DEDUCTIONS', 'PIT_BRACKETS', 'SI_RATES', 'BASE_SALARY_STATUTORY', 'REGIONAL_MIN_WAGE')),
  rule_code text NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  parameters jsonb NOT NULL,
  legal_reference text NOT NULL,
  is_verified boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, rule_code, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_compliance_rules_org_type ON compliance_statutory_rules (organization_id, rule_type, effective_from DESC);

-- 2. Employee Registered Dependents for PIT Family Reduction (Người phụ thuộc giảm trừ gia cảnh)
CREATE TABLE employee_dependents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL,
  full_name text NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('CHILD', 'SPOUSE', 'PARENT', 'OTHER')),
  tax_id text,
  id_number text,
  birth_date date,
  effective_from date NOT NULL,
  effective_to date,
  is_verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_emp_dependents_emp ON employee_dependents (organization_id, employee_id, effective_from DESC);
CREATE INDEX idx_emp_dependents_tax_id ON employee_dependents (organization_id, tax_id) WHERE tax_id IS NOT NULL;

-- 3. Compliance & Statutory Reports (Báo cáo thuế, bảo hiểm, chi phí nhân sự chính thức)
CREATE TABLE compliance_reports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  report_type text NOT NULL CHECK (report_type IN (
    'PIT_MONTHLY', 'PIT_QUARTERLY', 'PIT_ANNUAL',
    'SI_MONTHLY', 'SI_FLUCTUATION',
    'HR_COST_ANALYTICS'
  )),
  report_code text NOT NULL,
  title text NOT NULL,
  period_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'LOCKED')),
  summary_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  export_count integer NOT NULL DEFAULT 0,
  last_exported_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE SET NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, report_code),
  CHECK (period_end >= period_start)
);
CREATE INDEX idx_compliance_reports_org_type ON compliance_reports (organization_id, report_type, period_start DESC);

-- 4. Compliance Anomalies & Audit Findings (Phát hiện sai lệch, bất thường tuân thủ)
CREATE TABLE compliance_anomalies (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  report_id uuid,
  period_id uuid,
  employee_id uuid,
  anomaly_code text NOT NULL CHECK (anomaly_code IN (
    'SALARY_BELOW_REGIONAL_MIN',
    'MISSING_SI_PROFILE',
    'SI_CONTRIBUTION_CAP_MISMATCH',
    'MISSING_DEPENDENT_TAX_ID',
    'ANOMALOUS_FLUCTUATION',
    'UNRECONCILED_TAX_VARIANCE',
    'UNRECONCILED_SI_VARIANCE',
    'OTHER'
  )),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  description text NOT NULL,
  expected_value text,
  actual_value text,
  resolution_status text NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED')),
  resolution_notes text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (report_id, organization_id) REFERENCES compliance_reports(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_compliance_anomalies_report ON compliance_anomalies (organization_id, report_id);
CREATE INDEX idx_compliance_anomalies_period ON compliance_anomalies (organization_id, period_id);
CREATE INDEX idx_compliance_anomalies_status ON compliance_anomalies (organization_id, resolution_status);

-- 5. Compliance Audit Logs (Nhật ký kiểm soát tuân thủ, phê duyệt & xuất báo cáo)
CREATE TABLE compliance_audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  performed_by uuid NOT NULL REFERENCES users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_compliance_audit_org_target ON compliance_audit_logs (organization_id, target_type, target_id);
CREATE INDEX idx_compliance_audit_org_created ON compliance_audit_logs (organization_id, created_at DESC);

-- 6. Trigger to enforce immutability of LOCKED compliance reports
CREATE OR REPLACE FUNCTION guard_locked_compliance_report()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'LOCKED' THEN
    IF NEW.status <> OLD.status OR NEW.title <> OLD.title OR NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end OR NEW.summary_data::text <> OLD.summary_data::text OR NEW.report_code <> OLD.report_code OR NEW.report_type <> OLD.report_type THEN
      RAISE EXCEPTION 'Cannot modify a LOCKED compliance report';
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Cannot delete a LOCKED compliance report';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_locked_compliance_report
BEFORE UPDATE OR DELETE ON compliance_reports
FOR EACH ROW EXECUTE FUNCTION guard_locked_compliance_report();

COMMIT;
