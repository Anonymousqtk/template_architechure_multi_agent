-- RPT-002: Payroll & Accounting Reporting Schema Extensions
-- Forward-only, additive, transactional. Preserves existing tables.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Extend report_catalog category check constraint to include 'ACCOUNTING'
ALTER TABLE report_catalog DROP CONSTRAINT IF EXISTS report_catalog_category_check;
ALTER TABLE report_catalog ADD CONSTRAINT report_catalog_category_check
  CHECK (category IN ('EMPLOYEE', 'ORGANIZATION', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'ACCOUNTING', 'COMPLIANCE', 'OTHER'));

-- 2. Optimize reporting indexes for payroll & accounting aggregations
CREATE INDEX IF NOT EXISTS idx_payroll_slips_reporting
  ON payroll_slips (organization_id, period_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_slip_items_reporting
  ON payroll_slip_items (organization_id, type, component_name);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_reporting
  ON payroll_disbursements (organization_id, period_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_payroll_journal_reporting
  ON payroll_journal_entries (organization_id, period_id, status);

COMMIT;
