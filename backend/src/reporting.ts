import type { Express } from 'express';
import type { OrgStructureDeps } from './organization-structure.js';
import { registerReportBuilderRoutes } from './report-builder-routes.js';
import { createReportingContext } from './reporting-context.js';
import { registerReportExportRoutes } from './reporting-export.js';
import { registerHrReportRoutes } from './reporting-hr.js';
import { registerPayrollReportRoutes } from './reporting-payroll.js';
import { registerTaxInsuranceReportRoutes } from './reporting-tax.js';
import { registerReportTemplateRoutes } from './reporting-templates.js';

export {
  DEFAULT_PIT_BRACKETS,
  ANNUAL_PIT_BRACKETS,
  DEFAULT_REPORT_CATALOG,
  canAccessReport,
  toCents,
  toDecimal,
  buildEmployeeScopeClause,
} from './reporting-shared.js';
export type { ReportCatalogItem } from './reporting-shared.js';

// Route registration order is preserved from the original single-file module.
export function registerReportingRoutes(app: Express, deps: OrgStructureDeps) {
  registerReportBuilderRoutes(app, deps);
  const ctx = createReportingContext(deps);
  registerHrReportRoutes(app, ctx);
  registerPayrollReportRoutes(app, ctx);
  registerTaxInsuranceReportRoutes(app, ctx);
  registerReportExportRoutes(app, ctx);
  registerReportTemplateRoutes(app, ctx);
}
