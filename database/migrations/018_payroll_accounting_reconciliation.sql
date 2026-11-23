BEGIN;
SET LOCAL lock_timeout = '5s';

-- ============================================================
-- PAY-003: Payroll Accounting & Reconciliation
-- Migration 018 — Additive only.
-- ============================================================

-- 1. Chart of Accounts (Hệ thống tài khoản kế toán)
CREATE TABLE accounting_accounts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX accounting_accounts_org_code ON accounting_accounts (organization_id, upper(btrim(code)));
CREATE INDEX accounting_accounts_org_type ON accounting_accounts (organization_id, type);

-- 2. Accounting Posting Rules (Quy tắc định khoản hạch toán chi phí lương)
CREATE TABLE accounting_rules (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  rule_code text NOT NULL,
  name text NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('BASE_SALARY', 'ALLOWANCE', 'BONUS', 'DEDUCTION', 'OVERTIME', 'STATUTORY_SI', 'TAX', 'NET_PAY')),
  department_id uuid,
  debit_account_id uuid NOT NULL,
  credit_account_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (debit_account_id, organization_id) REFERENCES accounting_accounts(id, organization_id),
  FOREIGN KEY (credit_account_id, organization_id) REFERENCES accounting_accounts(id, organization_id),
  FOREIGN KEY (department_id, organization_id) REFERENCES departments(id, organization_id),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX accounting_rules_org_code ON accounting_rules (organization_id, upper(btrim(rule_code)));
CREATE INDEX accounting_rules_org_dept ON accounting_rules (organization_id, department_id);

-- 3. Payroll Journal Entries (Bút toán sổ nhật ký chung / phiếu kế toán lương)
CREATE TABLE payroll_journal_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_id uuid NOT NULL,
  entry_number text NOT NULL,
  entry_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
  total_debit numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_debit >= 0),
  total_credit numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_credit >= 0),
  description text,
  posted_by uuid REFERENCES users(id),
  posted_at timestamptz,
  reversed_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  reversal_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (reversal_entry_id, organization_id) REFERENCES payroll_journal_entries(id, organization_id),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, entry_number)
);
CREATE INDEX payroll_journal_entries_period ON payroll_journal_entries (organization_id, period_id);
CREATE INDEX payroll_journal_entries_date ON payroll_journal_entries (organization_id, entry_date DESC);

-- 4. Payroll Journal Entry Lines (Chi tiết các dòng định khoản Nợ / Có)
CREATE TABLE payroll_journal_entry_lines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  debit_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (debit_amount >= 0),
  credit_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (credit_amount >= 0),
  description text,
  line_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_id, organization_id) REFERENCES payroll_journal_entries(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, organization_id) REFERENCES accounting_accounts(id, organization_id),
  FOREIGN KEY (department_id, organization_id) REFERENCES departments(id, organization_id),
  UNIQUE (id, organization_id),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0))
);
CREATE INDEX payroll_journal_entry_lines_entry ON payroll_journal_entry_lines (entry_id);
CREATE INDEX payroll_journal_entry_lines_account ON payroll_journal_entry_lines (organization_id, account_id);

-- 5. Immutability Guard Trigger on Journal Entries and Lines
CREATE OR REPLACE FUNCTION guard_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry_status text;
BEGIN
  IF TG_TABLE_NAME = 'payroll_journal_entries' THEN
    IF OLD.status = 'POSTED' THEN
      IF NEW.status <> 'REVERSED' OR NEW.entry_number <> OLD.entry_number OR NEW.total_debit <> OLD.total_debit OR NEW.total_credit <> OLD.total_credit OR NEW.entry_date <> OLD.entry_date OR NEW.period_id <> OLD.period_id THEN
        RAISE EXCEPTION 'cannot modify a posted journal entry except for reversal';
      END IF;
    ELSIF OLD.status = 'REVERSED' THEN
      RAISE EXCEPTION 'cannot modify or delete a reversed journal entry';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'payroll_journal_entry_lines' THEN
    SELECT status INTO v_entry_status
    FROM payroll_journal_entries
    WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);
    IF v_entry_status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'cannot modify lines of a posted or reversed journal entry';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_posted_journal_entry
BEFORE UPDATE OR DELETE ON payroll_journal_entries
FOR EACH ROW EXECUTE FUNCTION guard_posted_journal_entry();

CREATE TRIGGER trg_guard_posted_journal_lines
BEFORE INSERT OR UPDATE OR DELETE ON payroll_journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION guard_posted_journal_entry();

-- 6. Payroll Disbursements (Dữ liệu chi trả thanh toán lương thực tế)
CREATE TABLE payroll_disbursements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_id uuid NOT NULL,
  slip_id uuid,
  employee_id uuid NOT NULL,
  disbursement_code text NOT NULL,
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'OTHER')),
  bank_name text,
  bank_account_number text,
  amount numeric(15, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  reference_code text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  FOREIGN KEY (slip_id, organization_id) REFERENCES payroll_slips(id, organization_id),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, disbursement_code)
);
CREATE INDEX payroll_disbursements_period ON payroll_disbursements (organization_id, period_id);
CREATE INDEX payroll_disbursements_employee ON payroll_disbursements (organization_id, employee_id);

-- 7. Payroll Reconciliation Records (Phiên đối chiếu bảng lương và thanh toán)
CREATE TABLE payroll_reconciliations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_id uuid NOT NULL,
  reconciliation_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'RECONCILED', 'DISCREPANCY_DETECTED', 'RESOLVED')),
  total_expected_slips integer NOT NULL DEFAULT 0 CHECK (total_expected_slips >= 0),
  total_expected_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_expected_amount >= 0),
  total_disbursed_slips integer NOT NULL DEFAULT 0 CHECK (total_disbursed_slips >= 0),
  total_disbursed_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_disbursed_amount >= 0),
  difference_amount numeric(15, 2) NOT NULL DEFAULT 0.00,
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  discrepancy_count integer NOT NULL DEFAULT 0 CHECK (discrepancy_count >= 0),
  notes text,
  reconciled_by uuid REFERENCES users(id),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id),
  UNIQUE (period_id)
);
CREATE INDEX payroll_reconciliations_org_status ON payroll_reconciliations (organization_id, status);

-- 8. Reconciliation Discrepancy Items (Chi tiết các khoản chênh lệch đối chiếu)
CREATE TABLE payroll_reconciliation_discrepancies (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  slip_id uuid,
  disbursement_id uuid,
  type text NOT NULL CHECK (type IN ('UNPAID', 'OVERPAID', 'UNDERPAID', 'DUPLICATE', 'ORPHAN_PAYMENT')),
  expected_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (expected_amount >= 0),
  disbursed_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (disbursed_amount >= 0),
  difference_amount numeric(15, 2) NOT NULL DEFAULT 0.00,
  resolution_status text NOT NULL DEFAULT 'PENDING' CHECK (resolution_status IN ('PENDING', 'INVESTIGATING', 'ADJUSTED', 'RESOLVED', 'IGNORED')),
  resolution_notes text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (reconciliation_id, organization_id) REFERENCES payroll_reconciliations(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id, organization_id) REFERENCES employees(id, organization_id),
  UNIQUE (id, organization_id)
);
CREATE INDEX payroll_discrepancies_rec ON payroll_reconciliation_discrepancies (reconciliation_id);
CREATE INDEX payroll_discrepancies_status ON payroll_reconciliation_discrepancies (organization_id, resolution_status);

-- 9. Payroll Liabilities (Theo dõi công nợ lương theo kỳ)
CREATE TABLE payroll_liabilities (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_id uuid NOT NULL,
  beginning_balance numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (beginning_balance >= 0),
  incurred_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (incurred_amount >= 0),
  paid_amount numeric(15, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
  ending_balance numeric(15, 2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SETTLED', 'PARTIALLY_SETTLED', 'OVERDUE')),
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, organization_id) REFERENCES payroll_periods(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id),
  UNIQUE (period_id)
);
CREATE INDEX payroll_liabilities_org ON payroll_liabilities (organization_id, status);

COMMIT;
