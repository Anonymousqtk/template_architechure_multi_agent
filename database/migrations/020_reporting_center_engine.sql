-- RPT-001: Reporting Center & Shared Reporting Engine Schema
-- Forward-only, additive, transactional. Preserves existing EMP, ORG, ATT, and PAY tables.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Report Catalog (Danh mục báo cáo của tổ chức)
CREATE TABLE report_catalog (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  category text NOT NULL CHECK (category IN ('EMPLOYEE', 'ORGANIZATION', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'COMPLIANCE', 'OTHER')),
  name text NOT NULL,
  description text,
  min_role text NOT NULL DEFAULT 'HR' CHECK (min_role IN ('ADMIN', 'HR', 'MANAGER', 'EMPLOYEE')),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  supported_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_catalog_org_code UNIQUE (organization_id, code),
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_report_catalog_org ON report_catalog (organization_id, category, is_active, display_order);

-- 2. Report Saved Templates (Bộ lọc và mẫu báo cáo lưu bởi người dùng)
CREATE TABLE report_saved_templates (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_code text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_saved_templates_user_name UNIQUE (organization_id, user_id, template_name),
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_report_saved_templates_user ON report_saved_templates (organization_id, user_id, report_code);

-- 3. Report Export Audit Logs (Nhật ký kiểm toán xuất dữ liệu báo cáo)
CREATE TABLE report_export_audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_code text NOT NULL,
  format text NOT NULL CHECK (format IN ('CSV', 'EXCEL', 'PDF', 'JSON')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_by uuid NOT NULL REFERENCES users(id),
  exported_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_report_export_audit_org ON report_export_audit_logs (organization_id, exported_at DESC);
CREATE INDEX idx_report_export_audit_code ON report_export_audit_logs (organization_id, report_code);
CREATE INDEX idx_report_export_audit_user ON report_export_audit_logs (organization_id, exported_by);

COMMIT;
