-- EMP-004: Employee Bank Account Details
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Add bank account columns to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_name text;

CREATE INDEX IF NOT EXISTS employees_org_bank
  ON employees (organization_id, bank_name);

COMMIT;
