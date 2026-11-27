// Saved templates and export audit log (split from reporting.ts, behavior unchanged).
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Authed } from './types.js';
import { uuid } from './reporting-shared.js';
import type { ReportingContext } from './reporting-context.js';

export function registerReportTemplateRoutes(app: Express, ctx: ReportingContext) {
  const { pool, prefix, identityFor } = ctx;

  // =========================================================================
  // 7. SAVED TEMPLATES & EXPORT AUDIT LOGS
  // =========================================================================

  // GET /api/organizations/:orgId/reports/templates
  app.get(`${prefix}/templates`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const rows = await pool.query<{
        id: string;
        report_code: string;
        template_name: string;
        filters: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT id, report_code, template_name, filters, created_at::text AS created_at
         FROM report_saved_templates
         WHERE organization_id = $1 AND user_id = $2
         ORDER BY template_name ASC`,
        [identity.orgId, identity.userId],
      );

      res.json({
        templates: rows.rows.map((r) => ({
          id: r.id,
          reportCode: r.report_code,
          templateName: r.template_name,
          filters: r.filters,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/organizations/:orgId/reports/templates
  app.post(`${prefix}/templates`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const schema = z.object({
        reportCode: z.string().min(1),
        templateName: z.string().trim().min(1).max(100),
        filters: z.record(z.string(), z.string()).default({}),
      });
      const body = schema.parse(req.body);

      const id = randomUUID();
      await pool.query(
        `INSERT INTO report_saved_templates (id, organization_id, report_code, user_id, template_name, filters)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (organization_id, user_id, template_name) DO UPDATE
         SET report_code = EXCLUDED.report_code,
             filters = EXCLUDED.filters,
             updated_at = now()`,
        [
          id,
          identity.orgId,
          body.reportCode,
          identity.userId,
          body.templateName,
          JSON.stringify(body.filters),
        ],
      );

      res.status(201).json({ id, message: 'Template saved successfully' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/organizations/:orgId/reports/templates/:id
  app.delete(`${prefix}/templates/:id`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const templateId = uuid.parse(req.params.id);

      const del = await pool.query(
        `DELETE FROM report_saved_templates
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [templateId, identity.orgId, identity.userId],
      );

      if (!del.rowCount) fail(404, 'TEMPLATE_NOT_FOUND');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/organizations/:orgId/reports/export-audit
  app.get(`${prefix}/export-audit`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');

      const rows = await pool.query<{
        id: string;
        report_code: string;
        format: string;
        row_count: number;
        filters: Record<string, unknown>;
        exported_by: string;
        user_name: string;
        user_email: string;
        exported_at: string;
      }>(
        `SELECT
          a.id, a.report_code, a.format, a.row_count, a.filters,
          a.exported_by, u.full_name AS user_name, u.email AS user_email,
          a.exported_at::text AS exported_at
        FROM report_export_audit_logs a
        JOIN users u ON u.id = a.exported_by
        WHERE a.organization_id = $1
        ORDER BY a.exported_at DESC
        LIMIT 100`,
        [identity.orgId],
      );

      res.json({
        auditLogs: rows.rows.map((r) => ({
          id: r.id,
          reportCode: r.report_code,
          format: r.format,
          rowCount: r.row_count,
          filters: r.filters,
          exportedBy: r.exported_by,
          userName: r.user_name,
          userEmail: r.user_email,
          exportedAt: r.exported_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });
}
