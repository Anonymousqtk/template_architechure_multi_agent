// Per-app reporting context shared by all report route modules.
import { randomUUID } from 'node:crypto';
import type { OrgStructureDeps } from './organization-structure.js';
import { fail, type Authed, type Identity } from './types.js';
import { uuid, DEFAULT_REPORT_CATALOG } from './reporting-shared.js';

export type ReportingContext = ReturnType<typeof createReportingContext>;

export function createReportingContext(deps: OrgStructureDeps) {
  const { pool, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/reports';

  function identityFor(req: Authed): Identity {
    const identity = requireIdentity(req);
    uuid.parse(req.params.organizationId);
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  // Ensure default catalog exists for organization
  async function ensureDefaultCatalog(orgId: string): Promise<void> {
    const countRes = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM report_catalog WHERE organization_id = $1',
      [orgId],
    );
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const item of DEFAULT_REPORT_CATALOG) {
        await pool.query(
          `INSERT INTO report_catalog (id, organization_id, code, category, name, description, min_role, display_order, supported_filters)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (organization_id, code) DO NOTHING`,
          [
            randomUUID(),
            orgId,
            item.code,
            item.category,
            item.name,
            item.description,
            item.minRole,
            item.displayOrder,
            JSON.stringify(item.supportedFilters),
          ],
        );
      }
    }
  }

  return { pool, audit, requireIdentity, prefix, identityFor, ensureDefaultCatalog };
}
