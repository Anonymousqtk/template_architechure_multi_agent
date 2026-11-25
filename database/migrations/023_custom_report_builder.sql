-- RPT-002: Dynamic Custom Report Builder & Analytics Studio Schema
-- Forward-only, additive, transactional. Preserves all existing tables and data.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Custom Reports (Saved report definitions, sharing, and versioning)
CREATE TABLE custom_reports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  description text,
  primary_entity text NOT NULL,
  related_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  definition jsonb NOT NULL,
  visualization_type text NOT NULL DEFAULT 'TABLE' CHECK (
    visualization_type IN (
      'TABLE', 'PIVOT', 'BAR', 'COLUMN', 'LINE', 'AREA',
      'PIE', 'DONUT', 'STACKED_BAR', 'COMBO', 'HEATMAP', 'KPI'
    )
  ),
  visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'SHARED', 'ORG_TEMPLATE')),
  shared_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  shared_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_template boolean NOT NULL DEFAULT false,
  template_code text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE INDEX idx_custom_reports_org_owner
  ON custom_reports (organization_id, created_by, updated_at DESC);
CREATE INDEX idx_custom_reports_org_visibility
  ON custom_reports (organization_id, visibility, is_template, updated_at DESC);

-- 2. Version History for Custom Reports
CREATE TABLE custom_report_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  report_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  visualization_type text NOT NULL,
  change_note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (report_id, organization_id) REFERENCES custom_reports(id, organization_id) ON DELETE CASCADE,
  UNIQUE (report_id, version),
  UNIQUE (id, organization_id)
);

CREATE INDEX idx_custom_report_versions_lookup
  ON custom_report_versions (organization_id, report_id, version DESC);

-- 3. Per-user Favorites & Recent View Tracking
CREATE TABLE custom_report_user_prefs (
  organization_id uuid NOT NULL,
  report_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_favorite boolean NOT NULL DEFAULT false,
  last_viewed_at timestamptz,
  PRIMARY KEY (report_id, user_id),
  FOREIGN KEY (report_id, organization_id) REFERENCES custom_reports(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX idx_custom_report_user_prefs_user
  ON custom_report_user_prefs (organization_id, user_id, is_favorite, last_viewed_at DESC);

-- 4. Asynchronous Export Jobs for Large Custom Reports
CREATE TABLE custom_report_export_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_id uuid,
  report_name text NOT NULL,
  format text NOT NULL CHECK (format IN ('CSV', 'EXCEL', 'PDF')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  definition_snapshot jsonb NOT NULL,
  locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  file_name text,
  content_type text,
  file_bytes bytea,
  error_code text,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (report_id, organization_id) REFERENCES custom_reports(id, organization_id) ON DELETE SET NULL,
  UNIQUE (id, organization_id)
);

CREATE INDEX idx_custom_report_export_jobs_user
  ON custom_report_export_jobs (organization_id, requested_by, created_at DESC);

COMMIT;
