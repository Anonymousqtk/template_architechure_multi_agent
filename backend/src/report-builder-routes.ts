import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import type { OrgStructureDeps } from './organization-structure.js';
import {
  executeCustomReport,
  executeCustomReportDrilldown,
  parseReportDefinition,
} from './report-builder-engine.js';
import { renderReportExport, type ExportFormat } from './report-builder-export.js';
import {
  FormulaError,
  validateFormulaExpression,
  type FormulaValueType,
} from './report-builder-formula.js';
import {
  getAuthorizedMetadata,
  hasMinRole,
  REPORT_ENTITIES,
  REPORT_FIELD_MAP,
  type EntityId,
} from './report-builder-metadata.js';
import { fail, type Authed, type Identity } from './types.js';

const uuid = z.string().uuid();

const VisualizationTypeSchema = z.enum([
  'TABLE',
  'PIVOT',
  'BAR',
  'COLUMN',
  'LINE',
  'AREA',
  'PIE',
  'DONUT',
  'STACKED_BAR',
  'COMBO',
  'HEATMAP',
  'KPI',
]);

const VisibilitySchema = z.enum(['PRIVATE', 'SHARED', 'ORG_TEMPLATE']);
const RoleListSchema = z.array(z.enum(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])).max(4);

interface CustomReportRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  primary_entity: EntityId;
  related_entities: EntityId[];
  definition: unknown;
  visualization_type: string;
  visibility: 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE';
  shared_roles: string[];
  shared_user_ids: string[];
  is_template: boolean;
  template_code: string | null;
  version: number;
  created_by: string;
  created_by_name?: string;
  updated_by: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
  last_viewed_at?: string | null;
}

function canReadSavedReport(report: CustomReportRow, identity: Identity): boolean {
  const entityMeta = REPORT_ENTITIES[report.primary_entity];
  if (!entityMeta || !hasMinRole(identity.role, entityMeta.minRole)) return false;
  if (report.created_by === identity.userId) return true;
  if (identity.role === 'ADMIN') return true;
  if (report.visibility === 'ORG_TEMPLATE' || report.is_template) return true;
  if (report.visibility === 'SHARED') {
    const roles = Array.isArray(report.shared_roles) ? report.shared_roles : [];
    const users = Array.isArray(report.shared_user_ids) ? report.shared_user_ids : [];
    return roles.includes(identity.role) || users.includes(identity.userId);
  }
  return false;
}

function canMutateSavedReport(report: CustomReportRow, identity: Identity): boolean {
  return report.created_by === identity.userId || identity.role === 'ADMIN';
}

function serializeReport(r: CustomReportRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    primaryEntity: r.primary_entity,
    relatedEntities: r.related_entities ?? [],
    definition: r.definition,
    visualizationType: r.visualization_type,
    visibility: r.visibility,
    sharedRoles: r.shared_roles ?? [],
    sharedUserIds: r.shared_user_ids ?? [],
    isTemplate: r.is_template,
    templateCode: r.template_code,
    version: r.version,
    createdBy: r.created_by,
    createdByName: r.created_by_name ?? null,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isFavorite: Boolean(r.is_favorite),
    lastViewedAt: r.last_viewed_at ?? null,
  };
}

export function registerReportBuilderRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/reports/builder';

  function identityFor(req: Authed): Identity {
    const identity = requireIdentity(req);
    uuid.parse(req.params.organizationId);
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  function localeFrom(req: Authed): 'vi' | 'en' {
    return req.query.locale === 'en' || req.body?.locale === 'en' ? 'en' : 'vi';
  }

  // 1. Metadata registry (authorized entities, fields, operators, aggregations, prebuilt templates)
  app.get(`${prefix}/metadata`, (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const locale = localeFrom(req);
      res.json(getAuthorizedMetadata(identity.role, locale));
    } catch (err) {
      next(err);
    }
  });

  // 2. Real-time calculated field formula validator
  app.post(`${prefix}/validate-formula`, (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          primaryEntity: z.string(),
          relatedEntities: z.array(z.string()).default([]),
          formula: z.string(),
          measureIds: z.array(z.string()).default([]),
        })
        .parse(req.body);

      const entityMeta = REPORT_ENTITIES[body.primaryEntity as EntityId];
      if (!entityMeta || !hasMinRole(identity.role, entityMeta.minRole)) {
        fail(403, 'FORBIDDEN');
      }

      const active = new Set<string>([body.primaryEntity, ...body.relatedEntities]);
      const fieldTypes = new Map<string, FormulaValueType>();
      for (const field of REPORT_FIELD_MAP.values()) {
        if (active.has(field.entity) && hasMinRole(identity.role, field.minRole)) {
          fieldTypes.set(
            field.id,
            field.dataType === 'currency' || field.dataType === 'number'
              ? 'number'
              : field.dataType === 'date'
                ? 'date'
                : field.dataType === 'boolean'
                  ? 'boolean'
                  : 'string',
          );
        }
      }
      for (const mId of body.measureIds) fieldTypes.set(mId, 'number');

      try {
        const result = validateFormulaExpression(body.formula, fieldTypes);
        res.json({
          valid: true,
          resultType: result.resultType,
          referencedFields: result.referencedFields,
        });
      } catch (err) {
        if (err instanceof FormulaError) {
          res.status(200).json({
            valid: false,
            errorCode: err.code,
            errorMessage: err.message,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // 3. Execute dynamic report definition (preview / run / pivot / chart / KPI)
  app.post(`${prefix}/execute`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          definition: z.unknown(),
          reportId: uuid.optional(),
          page: z.number().int().min(1).max(1000).default(1),
          pageSize: z.number().int().min(1).max(500).default(50),
          bypassCache: z.boolean().default(false),
          locale: z.enum(['vi', 'en']).default('vi'),
        })
        .parse(req.body);

      const result = await executeCustomReport(pool, identity, body.definition, {
        locale: body.locale,
        page: body.page,
        pageSize: body.pageSize,
        bypassCache: body.bypassCache,
      });

      if (body.reportId) {
        await pool.query(
          `UPDATE custom_reports SET last_run_at = now() WHERE id = $1 AND organization_id = $2`,
          [body.reportId, identity.orgId],
        );
        await pool.query(
          `INSERT INTO custom_report_user_prefs (organization_id, report_id, user_id, is_favorite, last_viewed_at)
           VALUES ($1, $2, $3, false, now())
           ON CONFLICT (report_id, user_id) DO UPDATE SET last_viewed_at = now()`,
          [identity.orgId, body.reportId, identity.userId],
        );
      }

      await audit(pool, 'CUSTOM_REPORT_EXECUTED', identity.userId, identity.orgId, undefined, {
        reportId: body.reportId ?? null,
        primaryEntity: result.meta.primaryEntity,
        mode: result.mode,
        rowCount: result.pagination.totalRows,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // 4. Drill-down into authorized underlying records
  app.post(`${prefix}/drilldown`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          definition: z.unknown(),
          dimensionFilters: z
            .array(
              z.object({
                fieldId: z.string().min(1).max(100),
                value: z.unknown(),
                granularity: z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).optional(),
              }),
            )
            .max(5),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
          locale: z.enum(['vi', 'en']).default('vi'),
        })
        .parse(req.body);

      const result = await executeCustomReportDrilldown(
        pool,
        identity,
        body.definition,
        body.dimensionFilters,
        { locale: body.locale, page: body.page, pageSize: body.pageSize },
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // 5. Report Library: List My Reports, Shared Reports, Templates, Favorites, Recent
  app.get(`${prefix}/library`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const rows = await pool.query<CustomReportRow>(
        `SELECT
           cr.*,
           u.full_name AS created_by_name,
           COALESCE(p.is_favorite, false) AS is_favorite,
           p.last_viewed_at::text AS last_viewed_at
         FROM custom_reports cr
         JOIN users u ON u.id = cr.created_by
         LEFT JOIN custom_report_user_prefs p
           ON p.report_id = cr.id AND p.user_id = $2
         WHERE cr.organization_id = $1
         ORDER BY cr.updated_at DESC`,
        [identity.orgId, identity.userId],
      );

      const accessible = rows.rows
        .filter((r) => canReadSavedReport(r, identity))
        .map(serializeReport);
      res.json({ reports: accessible });
    } catch (err) {
      next(err);
    }
  });

  // 6. Save new custom report
  app.post(`${prefix}/library`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          name: z.string().trim().min(1).max(150),
          description: z.string().trim().max(500).nullable().optional(),
          definition: z.unknown(),
          visualizationType: VisualizationTypeSchema.default('TABLE'),
          visibility: VisibilitySchema.default('PRIVATE'),
          sharedRoles: RoleListSchema.default([]),
          sharedUserIds: z.array(uuid).max(50).default([]),
          isTemplate: z.boolean().default(false),
          changeNote: z.string().trim().max(250).optional(),
        })
        .parse(req.body);

      const parsedDef = parseReportDefinition(body.definition);
      const entityMeta = REPORT_ENTITIES[parsedDef.primaryEntity];
      if (!entityMeta || !hasMinRole(identity.role, entityMeta.minRole)) {
        fail(403, 'FORBIDDEN');
      }
      if (
        (body.visibility === 'ORG_TEMPLATE' || body.isTemplate) &&
        !['ADMIN', 'HR'].includes(identity.role)
      ) {
        fail(403, 'FORBIDDEN');
      }

      const id = randomUUID();
      await transaction(async (db) => {
        await db.query(
          `INSERT INTO custom_reports (
            id, organization_id, name, description, primary_entity, related_entities,
            definition, visualization_type, visibility, shared_roles, shared_user_ids,
            is_template, version, created_by, updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12,1,$13,$13)`,
          [
            id,
            identity.orgId,
            body.name,
            body.description ?? null,
            parsedDef.primaryEntity,
            JSON.stringify(parsedDef.relatedEntities),
            JSON.stringify(parsedDef),
            body.visualizationType,
            body.visibility,
            JSON.stringify(body.sharedRoles),
            JSON.stringify(body.sharedUserIds),
            body.isTemplate,
            identity.userId,
          ],
        );

        await db.query(
          `INSERT INTO custom_report_versions (id, organization_id, report_id, version, definition, visualization_type, change_note, created_by)
           VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$7)`,
          [
            randomUUID(),
            identity.orgId,
            id,
            JSON.stringify(parsedDef),
            body.visualizationType,
            body.changeNote ?? 'Initial version',
            identity.userId,
          ],
        );
      });

      await audit(pool, 'CUSTOM_REPORT_CREATED', identity.userId, identity.orgId, undefined, {
        reportId: id,
        name: body.name,
        primaryEntity: parsedDef.primaryEntity,
        visibility: body.visibility,
      });

      const createdRes = await pool.query<CustomReportRow>(
        `SELECT cr.*, u.full_name AS created_by_name
         FROM custom_reports cr JOIN users u ON u.id = cr.created_by
         WHERE cr.id = $1 AND cr.organization_id = $2`,
        [id, identity.orgId],
      );

      res.status(201).json({ report: serializeReport(createdRes.rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  // 7. Get single saved report + version history (re-checks authorization)
  app.get(`${prefix}/library/:reportId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = uuid.parse(req.params.reportId);

      const rowRes = await pool.query<CustomReportRow>(
        `SELECT cr.*, u.full_name AS created_by_name,
           COALESCE(p.is_favorite, false) AS is_favorite, p.last_viewed_at::text AS last_viewed_at
         FROM custom_reports cr
         JOIN users u ON u.id = cr.created_by
         LEFT JOIN custom_report_user_prefs p ON p.report_id = cr.id AND p.user_id = $3
         WHERE cr.id = $1 AND cr.organization_id = $2`,
        [reportId, identity.orgId, identity.userId],
      );
      if (!rowRes.rows.length) fail(404, 'REPORT_NOT_FOUND');

      const report = rowRes.rows[0];
      if (!canReadSavedReport(report, identity)) fail(403, 'FORBIDDEN');

      const versionsRes = await pool.query<{
        id: string;
        version: number;
        visualization_type: string;
        change_note: string | null;
        created_at: string;
      }>(
        `SELECT id, version, visualization_type, change_note, created_at::text AS created_at
         FROM custom_report_versions
         WHERE report_id = $1 AND organization_id = $2
         ORDER BY version DESC LIMIT 20`,
        [reportId, identity.orgId],
      );

      res.json({
        report: serializeReport(report),
        versions: versionsRes.rows.map((v) => ({
          id: v.id,
          version: v.version,
          visualizationType: v.visualization_type,
          changeNote: v.change_note,
          createdAt: v.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // 8. Update / rename / share saved report (creates a new version)
  app.patch(`${prefix}/library/:reportId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = uuid.parse(req.params.reportId);

      const existingRes = await pool.query<CustomReportRow>(
        `SELECT * FROM custom_reports WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId],
      );
      if (!existingRes.rows.length) fail(404, 'REPORT_NOT_FOUND');
      const existing = existingRes.rows[0];
      if (!canMutateSavedReport(existing, identity)) fail(403, 'FORBIDDEN');

      const body = z
        .object({
          name: z.string().trim().min(1).max(150).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          definition: z.unknown().optional(),
          visualizationType: VisualizationTypeSchema.optional(),
          visibility: VisibilitySchema.optional(),
          sharedRoles: RoleListSchema.optional(),
          sharedUserIds: z.array(uuid).max(50).optional(),
          changeNote: z.string().trim().max(250).optional(),
        })
        .parse(req.body);

      const nextDef = body.definition
        ? parseReportDefinition(body.definition)
        : parseReportDefinition(existing.definition);
      const nextVis = body.visualizationType ?? existing.visualization_type;
      const nextVisibility = body.visibility ?? existing.visibility;
      if (nextVisibility === 'ORG_TEMPLATE' && !['ADMIN', 'HR'].includes(identity.role)) {
        fail(403, 'FORBIDDEN');
      }

      const nextVersion = existing.version + 1;
      await transaction(async (db) => {
        await db.query(
          `UPDATE custom_reports
           SET name = $3,
               description = $4,
               primary_entity = $5,
               related_entities = $6::jsonb,
               definition = $7::jsonb,
               visualization_type = $8,
               visibility = $9,
               shared_roles = $10::jsonb,
               shared_user_ids = $11::jsonb,
               version = $12,
               updated_by = $13,
               updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [
            reportId,
            identity.orgId,
            body.name ?? existing.name,
            body.description !== undefined ? body.description : existing.description,
            nextDef.primaryEntity,
            JSON.stringify(nextDef.relatedEntities),
            JSON.stringify(nextDef),
            nextVis,
            nextVisibility,
            JSON.stringify(body.sharedRoles ?? existing.shared_roles ?? []),
            JSON.stringify(body.sharedUserIds ?? existing.shared_user_ids ?? []),
            nextVersion,
            identity.userId,
          ],
        );

        await db.query(
          `INSERT INTO custom_report_versions (id, organization_id, report_id, version, definition, visualization_type, change_note, created_by)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [
            randomUUID(),
            identity.orgId,
            reportId,
            nextVersion,
            JSON.stringify(nextDef),
            nextVis,
            body.changeNote ?? `Updated v${nextVersion}`,
            identity.userId,
          ],
        );
      });

      await audit(pool, 'CUSTOM_REPORT_UPDATED', identity.userId, identity.orgId, undefined, {
        reportId,
        version: nextVersion,
        visibility: nextVisibility,
      });

      const updatedRes = await pool.query<CustomReportRow>(
        `SELECT cr.*, u.full_name AS created_by_name
         FROM custom_reports cr JOIN users u ON u.id = cr.created_by
         WHERE cr.id = $1 AND cr.organization_id = $2`,
        [reportId, identity.orgId],
      );
      res.json({ report: serializeReport(updatedRes.rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  // 9. Duplicate saved report into caller's My Reports
  app.post(`${prefix}/library/:reportId/duplicate`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = uuid.parse(req.params.reportId);

      const existingRes = await pool.query<CustomReportRow>(
        `SELECT * FROM custom_reports WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId],
      );
      if (!existingRes.rows.length) fail(404, 'REPORT_NOT_FOUND');
      const source = existingRes.rows[0];
      if (!canReadSavedReport(source, identity)) fail(403, 'FORBIDDEN');

      const body = z
        .object({ name: z.string().trim().min(1).max(150).optional() })
        .parse(req.body ?? {});

      const newId = randomUUID();
      const copyName = body.name ?? `${source.name} (Copy)`.slice(0, 150);

      await transaction(async (db) => {
        await db.query(
          `INSERT INTO custom_reports (
            id, organization_id, name, description, primary_entity, related_entities,
            definition, visualization_type, visibility, shared_roles, shared_user_ids,
            is_template, version, created_by, updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'PRIVATE','[]'::jsonb,'[]'::jsonb,false,1,$9,$9)`,
          [
            newId,
            identity.orgId,
            copyName,
            source.description,
            source.primary_entity,
            JSON.stringify(source.related_entities ?? []),
            JSON.stringify(source.definition),
            source.visualization_type,
            identity.userId,
          ],
        );
        await db.query(
          `INSERT INTO custom_report_versions (id, organization_id, report_id, version, definition, visualization_type, change_note, created_by)
           VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$7)`,
          [
            randomUUID(),
            identity.orgId,
            newId,
            JSON.stringify(source.definition),
            source.visualization_type,
            `Duplicated from ${source.id}`,
            identity.userId,
          ],
        );
      });

      const createdRes = await pool.query<CustomReportRow>(
        `SELECT cr.*, u.full_name AS created_by_name
         FROM custom_reports cr JOIN users u ON u.id = cr.created_by
         WHERE cr.id = $1 AND cr.organization_id = $2`,
        [newId, identity.orgId],
      );
      res.status(201).json({ report: serializeReport(createdRes.rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  // 10. Delete saved report
  app.delete(`${prefix}/library/:reportId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = uuid.parse(req.params.reportId);

      const existingRes = await pool.query<CustomReportRow>(
        `SELECT * FROM custom_reports WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId],
      );
      if (!existingRes.rows.length) fail(404, 'REPORT_NOT_FOUND');
      if (!canMutateSavedReport(existingRes.rows[0], identity)) fail(403, 'FORBIDDEN');

      await pool.query(`DELETE FROM custom_reports WHERE id = $1 AND organization_id = $2`, [
        reportId,
        identity.orgId,
      ]);
      await audit(pool, 'CUSTOM_REPORT_DELETED', identity.userId, identity.orgId, undefined, {
        reportId,
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // 11. Toggle favorite
  app.post(`${prefix}/library/:reportId/favorite`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = uuid.parse(req.params.reportId);
      const body = z.object({ isFavorite: z.boolean() }).parse(req.body);

      const existingRes = await pool.query<CustomReportRow>(
        `SELECT * FROM custom_reports WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId],
      );
      if (!existingRes.rows.length) fail(404, 'REPORT_NOT_FOUND');
      if (!canReadSavedReport(existingRes.rows[0], identity)) fail(403, 'FORBIDDEN');

      await pool.query(
        `INSERT INTO custom_report_user_prefs (organization_id, report_id, user_id, is_favorite)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (report_id, user_id) DO UPDATE SET is_favorite = EXCLUDED.is_favorite`,
        [identity.orgId, reportId, identity.userId, body.isFavorite],
      );
      res.json({ isFavorite: body.isFavorite });
    } catch (err) {
      next(err);
    }
  });

  // 12. Synchronous Export (CSV, EXCEL, PDF) for full matching authorized records
  app.post(`${prefix}/export`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          reportName: z.string().trim().min(1).max(150).default('Custom Report'),
          format: z.enum(['CSV', 'EXCEL', 'PDF']),
          definition: z.unknown(),
          locale: z.enum(['vi', 'en']).default('vi'),
        })
        .parse(req.body);

      const result = await executeCustomReport(pool, identity, body.definition, {
        locale: body.locale,
        page: 1,
        exportAll: true,
        bypassCache: true,
      });

      const file = renderReportExport(
        body.reportName,
        body.format as ExportFormat,
        result,
        body.locale,
      );

      await pool.query(
        `INSERT INTO report_export_audit_logs
         (id, organization_id, report_code, format, row_count, filters, exported_by, ip_address, user_agent)
         VALUES ($1,$2,'RPT-002-CUSTOM',$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          randomUUID(),
          identity.orgId,
          body.format,
          file.rowCount,
          JSON.stringify({ reportName: body.reportName, primaryEntity: result.meta.primaryEntity }),
          identity.userId,
          req.ip || null,
          req.get('user-agent') || null,
        ],
      );

      await audit(pool, 'CUSTOM_REPORT_EXPORTED', identity.userId, identity.orgId, undefined, {
        reportName: body.reportName,
        format: body.format,
        rowCount: file.rowCount,
      });

      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.status(200).send(file.buffer);
    } catch (err) {
      next(err);
    }
  });

  // 13. Asynchronous Export Jobs for large datasets
  app.post(`${prefix}/export-jobs`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const body = z
        .object({
          reportId: uuid.optional(),
          reportName: z.string().trim().min(1).max(150).default('Custom Report'),
          format: z.enum(['CSV', 'EXCEL', 'PDF']),
          definition: z.unknown(),
          locale: z.enum(['vi', 'en']).default('vi'),
        })
        .parse(req.body);

      const parsedDef = parseReportDefinition(body.definition);
      const entityMeta = REPORT_ENTITIES[parsedDef.primaryEntity];
      if (!entityMeta || !hasMinRole(identity.role, entityMeta.minRole)) {
        fail(403, 'FORBIDDEN');
      }

      const jobId = randomUUID();
      await pool.query(
        `INSERT INTO custom_report_export_jobs (
           id, organization_id, report_id, report_name, format, status,
           definition_snapshot, locale, requested_by
         ) VALUES ($1,$2,$3,$4,$5,'PENDING',$6::jsonb,$7,$8)`,
        [
          jobId,
          identity.orgId,
          body.reportId ?? null,
          body.reportName,
          body.format,
          JSON.stringify(parsedDef),
          body.locale,
          identity.userId,
        ],
      );

      // Process asynchronously on next tick so request returns 202 immediately
      setImmediate(async () => {
        try {
          await pool.query(
            `UPDATE custom_report_export_jobs SET status = 'PROCESSING' WHERE id = $1 AND organization_id = $2`,
            [jobId, identity.orgId],
          );
          const result = await executeCustomReport(pool, identity, parsedDef, {
            locale: body.locale,
            page: 1,
            exportAll: true,
            bypassCache: true,
          });
          const file = renderReportExport(body.reportName, body.format, result, body.locale);

          await pool.query(
            `UPDATE custom_report_export_jobs
             SET status = 'COMPLETED', row_count = $3, file_name = $4, content_type = $5, file_bytes = $6, completed_at = now()
             WHERE id = $1 AND organization_id = $2`,
            [jobId, identity.orgId, file.rowCount, file.fileName, file.contentType, file.buffer],
          );
          await pool.query(
            `INSERT INTO report_export_audit_logs
             (id, organization_id, report_code, format, row_count, filters, exported_by)
             VALUES ($1,$2,'RPT-002-CUSTOM',$3,$4,$5::jsonb,$6)`,
            [
              randomUUID(),
              identity.orgId,
              body.format,
              file.rowCount,
              JSON.stringify({ jobId, reportName: body.reportName }),
              identity.userId,
            ],
          );
        } catch (err) {
          await pool
            .query(
              `UPDATE custom_report_export_jobs
               SET status = 'FAILED', error_code = $3, completed_at = now()
               WHERE id = $1 AND organization_id = $2`,
              [
                jobId,
                identity.orgId,
                err instanceof Error ? err.message.slice(0, 80) : 'EXPORT_FAILED',
              ],
            )
            .catch(() => {});
        }
      });

      res.status(202).json({ jobId, status: 'PENDING' });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${prefix}/export-jobs/:jobId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const jobId = uuid.parse(req.params.jobId);
      const jobRes = await pool.query<{
        id: string;
        status: string;
        format: string;
        row_count: number;
        file_name: string | null;
        error_code: string | null;
        requested_by: string;
        created_at: string;
        completed_at: string | null;
      }>(
        `SELECT id, status, format, row_count, file_name, error_code, requested_by, created_at::text, completed_at::text
         FROM custom_report_export_jobs
         WHERE id = $1 AND organization_id = $2`,
        [jobId, identity.orgId],
      );
      if (!jobRes.rows.length) fail(404, 'EXPORT_JOB_NOT_FOUND');
      const job = jobRes.rows[0];
      if (job.requested_by !== identity.userId && identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');

      res.json({
        id: job.id,
        status: job.status,
        format: job.format,
        rowCount: job.row_count,
        fileName: job.file_name,
        errorCode: job.error_code,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${prefix}/export-jobs/:jobId/download`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const jobId = uuid.parse(req.params.jobId);
      const jobRes = await pool.query<{
        status: string;
        file_name: string | null;
        content_type: string | null;
        file_bytes: Buffer | null;
        requested_by: string;
      }>(
        `SELECT status, file_name, content_type, file_bytes, requested_by
         FROM custom_report_export_jobs
         WHERE id = $1 AND organization_id = $2`,
        [jobId, identity.orgId],
      );
      if (!jobRes.rows.length) fail(404, 'EXPORT_JOB_NOT_FOUND');
      const job = jobRes.rows[0];
      if (job.requested_by !== identity.userId && identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');
      if (job.status !== 'COMPLETED' || !job.file_bytes) fail(409, 'EXPORT_NOT_READY');

      res.setHeader('Content-Type', job.content_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${job.file_name || 'report.csv'}"`,
      );
      res.status(200).send(job.file_bytes);
    } catch (err) {
      next(err);
    }
  });
}
