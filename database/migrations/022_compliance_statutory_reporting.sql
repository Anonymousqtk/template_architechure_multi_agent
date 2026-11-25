-- RPT-003: Compliance & Statutory Reporting Schema Extensions
-- Forward-only, additive, transactional. Preserves existing tables.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Extend compliance_reports report_type check to include 'LABOR_UTILIZATION'
ALTER TABLE compliance_reports DROP CONSTRAINT IF EXISTS compliance_reports_report_type_check;
ALTER TABLE compliance_reports ADD CONSTRAINT compliance_reports_report_type_check
  CHECK (report_type IN (
    'PIT_MONTHLY', 'PIT_QUARTERLY', 'PIT_ANNUAL',
    'SI_MONTHLY', 'SI_FLUCTUATION',
    'HR_COST_ANALYTICS', 'LABOR_UTILIZATION'
  ));

-- 2. Add composite reporting performance indexes
CREATE INDEX IF NOT EXISTS idx_emp_contracts_reporting
  ON employee_contracts (organization_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_social_insurance_contrib_reporting
  ON social_insurance_contributions (organization_id, employee_id, contribution_month DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_anomalies_reporting
  ON compliance_anomalies (organization_id, period_id, severity);

COMMIT;
