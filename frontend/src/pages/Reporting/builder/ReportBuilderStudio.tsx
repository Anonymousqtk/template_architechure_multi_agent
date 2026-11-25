import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SlideDialog } from '../../../components/common/SlideDialog';
import type { Locale } from '../../../i18n';
import { ApiError, errorText, getCsrfToken, request } from '../../../services/api';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { AdvancedFilterBuilder } from './AdvancedFilterBuilder';
import { CalculatedFieldModal } from './CalculatedFieldModal';
import { CustomReportsLibrary } from './CustomReportsLibrary';
import { DataExplorerPanel } from './DataExplorerPanel';
import { ReportCanvasPanel } from './ReportCanvasPanel';
import { ReportConfigPanel } from './ReportConfigPanel';
import type {
  CalculatedFieldConfig,
  CustomReportRecord,
  DropZoneName,
  EntityId,
  EntityMeta,
  ExportJobState,
  FieldMeta,
  PrebuiltTemplate,
  ReportDefinition,
  ReportExecutionResult,
  ResultColumn,
} from './reportBuilderTypes';
import { createEmptyReportDefinition, normalizeDefinition } from './reportBuilderTypes';
import { ShareReportModal } from './ShareReportModal';
import {
  addFieldToZone,
  canDropFieldInZone,
  useReportBuilderHistory,
} from './useReportBuilderHistory';

interface Props {
  organizationId: string;
  currentUserId: string;
  userRole: string;
  locale: Locale;
  msg: ReportBuilderMessages;
}

function normalizeMetadataResponse(raw: {
  entities?: Array<Record<string, unknown>>;
  fields?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
}): { entities: EntityMeta[]; fields: FieldMeta[]; templates: PrebuiltTemplate[] } {
  const entities: EntityMeta[] = (raw.entities ?? []).map((e) => {
    const label = String(e.label ?? e.labelVi ?? e.labelEn ?? e.id ?? '');
    const desc = String(e.description ?? e.descriptionVi ?? e.descriptionEn ?? '');
    const rawRels = Array.isArray(e.relatedEntities)
      ? e.relatedEntities
      : Array.isArray(e.allowedRelations)
        ? e.allowedRelations
        : [];
    const relatedEntities = rawRels.map((r) => {
      const rel = r as Record<string, unknown>;
      const target = (rel.entity ?? rel.targetEntity) as EntityId;
      const rDesc = String(rel.description ?? rel.joinDescriptionVi ?? rel.joinDescriptionEn ?? '');
      return {
        entity: target,
        relationshipType: 'MANY_TO_ONE' as const,
        joinDescriptionVi: String(rel.joinDescriptionVi ?? rDesc),
        joinDescriptionEn: String(rel.joinDescriptionEn ?? rDesc),
      };
    });
    return {
      id: e.id as EntityId,
      category: String(e.category ?? e.grain ?? 'HR'),
      labelVi: String(e.labelVi ?? label),
      labelEn: String(e.labelEn ?? label),
      descriptionVi: String(e.descriptionVi ?? desc),
      descriptionEn: String(e.descriptionEn ?? desc),
      minRole: (e.minRole as EntityMeta['minRole']) ?? 'EMPLOYEE',
      relatedEntities,
    };
  });

  const fields: FieldMeta[] = (raw.fields ?? []).map((f) => {
    const label = String(f.label ?? f.labelVi ?? f.labelEn ?? f.id ?? '');
    const cat = String(f.category ?? f.categoryVi ?? f.categoryEn ?? 'General');
    const desc = String(f.description ?? f.descriptionVi ?? f.descriptionEn ?? '');
    const rawEnum = Array.isArray(f.enumValues) ? f.enumValues : undefined;
    return {
      id: String(f.id),
      entity: f.entity as EntityId,
      categoryVi: String(f.categoryVi ?? cat),
      categoryEn: String(f.categoryEn ?? cat),
      labelVi: String(f.labelVi ?? label),
      labelEn: String(f.labelEn ?? label),
      descriptionVi: String(f.descriptionVi ?? desc),
      descriptionEn: String(f.descriptionEn ?? desc),
      dataType: (f.dataType as FieldMeta['dataType']) ?? 'string',
      defaultFormat: (f.defaultFormat as FieldMeta['defaultFormat']) ?? 'text',
      allowedAggregations: (f.allowedAggregations as FieldMeta['allowedAggregations']) ?? ['COUNT'],
      filterOperators: (f.filterOperators as FieldMeta['filterOperators']) ?? ['eq'],
      enumValues: rawEnum?.map((ev) => {
        const opt = ev as Record<string, unknown>;
        const optLabel = String(opt.label ?? opt.labelVi ?? opt.labelEn ?? opt.value ?? '');
        return {
          value: String(opt.value),
          labelVi: String(opt.labelVi ?? optLabel),
          labelEn: String(opt.labelEn ?? optLabel),
        };
      }),
      groupable: Boolean(f.groupable),
      sortable: Boolean(f.sortable),
      minRole: (f.minRole as FieldMeta['minRole']) ?? 'EMPLOYEE',
    };
  });

  const templates: PrebuiltTemplate[] = (raw.templates ?? []).map((t) => {
    const defObj = (t.definition ?? {
      primaryEntity: t.primaryEntity ?? 'employees',
      relatedEntities: t.relatedEntities ?? [],
    }) as Partial<ReportDefinition> & { primaryEntity: EntityId };
    const name = String(t.name ?? t.nameVi ?? t.nameEn ?? t.templateCode ?? '');
    const desc = String(t.description ?? t.descriptionVi ?? t.descriptionEn ?? '');
    return {
      code: String(t.code ?? t.templateCode ?? ''),
      nameVi: String(t.nameVi ?? name),
      nameEn: String(t.nameEn ?? name),
      descriptionVi: String(t.descriptionVi ?? desc),
      descriptionEn: String(t.descriptionEn ?? desc),
      category: String(t.category ?? t.primaryEntity ?? 'HR'),
      visualizationType: (t.visualizationType as PrebuiltTemplate['visualizationType']) ?? 'TABLE',
      definition: defObj,
    };
  });

  return { entities, fields, templates };
}

export function ReportBuilderStudio({
  organizationId,
  currentUserId,
  userRole,
  locale,
  msg,
}: Props) {
  const [viewMode, setViewMode] = useState<'LIBRARY' | 'STUDIO'>('LIBRARY');
  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [templates, setTemplates] = useState<PrebuiltTemplate[]>([]);
  const [libraryReports, setLibraryReports] = useState<CustomReportRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportName, setReportName] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE'>('PRIVATE');
  const [sharedRoles, setSharedRoles] = useState<Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>>(
    [],
  );
  const [isTemplate, setIsTemplate] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { definition, canUndo, canRedo, setDefinition, resetHistory, undo, redo } =
    useReportBuilderHistory(createEmptyReportDefinition('employees'));

  const [result, setResult] = useState<ReportExecutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJobState | null>(null);

  const [showExplorer, setShowExplorer] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [leftWidth, setLeftWidth] = useState(268);
  const [rightWidth, setRightWidth] = useState(310);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'DATA' | 'CONFIG' | 'RESULT'>('DATA');
  const [tabletDrawer, setTabletDrawer] = useState<'NONE' | 'DATA' | 'CONFIG'>('NONE');
  const [quickAssignField, setQuickAssignField] = useState<FieldMeta | null>(null);

  const [formulaModalState, setFormulaModalState] = useState<{
    open: boolean;
    editing?: CalculatedFieldConfig;
  }>({ open: false });
  const [filterOpen, setFilterOpen] = useState(false);
  const [shareModalState, setShareModalState] = useState<{
    open: boolean;
    mode: 'SAVE_AS' | 'SHARE';
    targetReport?: CustomReportRecord;
  }>({ open: false, mode: 'SAVE_AS' });

  const abortCounter = useRef(0);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  const availableFieldsForActive = useMemo(() => {
    const allowed = new Set<EntityId>([definition.primaryEntity, ...definition.relatedEntities]);
    return fields.filter((f) => allowed.has(f.entity));
  }, [fields, definition.primaryEntity, definition.relatedEntities]);

  const loadMetadataAndLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setNotice(null);
    try {
      const [metaSettled, libSettled] = await Promise.allSettled([
        request<{
          entities: Array<Record<string, unknown>>;
          fields: Array<Record<string, unknown>>;
          templates: Array<Record<string, unknown>>;
        }>(`/api/organizations/${organizationId}/reports/builder/metadata?locale=${locale}`),
        request<{ reports: CustomReportRecord[] }>(
          `/api/organizations/${organizationId}/reports/builder/library`,
        ),
      ]);

      if (metaSettled.status === 'fulfilled') {
        const adapted = normalizeMetadataResponse(metaSettled.value);
        setEntities(adapted.entities);
        setFields(adapted.fields);
        setTemplates(adapted.templates);
      } else {
        setNotice(errorText(metaSettled.reason));
      }

      if (libSettled.status === 'fulfilled') {
        setLibraryReports(libSettled.value.reports);
      } else if (metaSettled.status === 'fulfilled') {
        setNotice(errorText(libSettled.reason));
      }
    } finally {
      setLibraryLoading(false);
    }
  }, [organizationId, locale]);

  useEffect(() => {
    void loadMetadataAndLibrary();
  }, [loadMetadataAndLibrary]);

  const executeReport = useCallback(
    async (def: ReportDefinition, page = 1, bypassCache = false) => {
      const reqId = ++abortCounter.current;
      setRunning(true);
      setRunError(null);
      try {
        const res = await request<ReportExecutionResult>(
          `/api/organizations/${organizationId}/reports/builder/execute`,
          {
            definition: def,
            reportId: activeReportId ?? undefined,
            page,
            pageSize: def.pageSize,
            bypassCache,
            locale,
          },
          'POST',
        );
        if (abortCounter.current === reqId) {
          setResult(res);
        }
      } catch (err) {
        if (abortCounter.current === reqId) {
          setRunError(errorText(err));
        }
      } finally {
        if (abortCounter.current === reqId) {
          setRunning(false);
        }
      }
    },
    [organizationId, activeReportId, locale],
  );

  const openBlankInStudio = () => {
    const firstEntity = entities[0]?.id ?? 'employees';
    setActiveReportId(null);
    setReportName(msg.library.newBlankReport);
    setReportDescription('');
    setVisibility('PRIVATE');
    setSharedRoles([]);
    setIsTemplate(false);
    setDirty(false);
    setResult(null);
    setRunError(null);
    resetHistory(createEmptyReportDefinition(firstEntity));
    setMobileTab('DATA');
    setTabletDrawer('NONE');
    setViewMode('STUDIO');
  };

  const openReportInStudio = (report: CustomReportRecord) => {
    const norm = normalizeDefinition({
      ...report.definition,
      visualizationType: report.visualizationType ?? report.definition.visualizationType,
    });
    setActiveReportId(report.id);
    setReportName(report.name);
    setReportDescription(report.description ?? '');
    setVisibility(report.visibility);
    setSharedRoles(report.sharedRoles ?? []);
    setIsTemplate(report.isTemplate);
    setDirty(false);
    setResult(null);
    setRunError(null);
    resetHistory(norm);
    setMobileTab('RESULT');
    setTabletDrawer('NONE');
    setViewMode('STUDIO');
    void executeReport(norm, 1);
  };

  const openTemplateInStudio = (tpl: PrebuiltTemplate) => {
    const norm = normalizeDefinition({
      ...tpl.definition,
      visualizationType: tpl.visualizationType,
    });
    setActiveReportId(null);
    setReportName(locale === 'en' ? tpl.nameEn : tpl.nameVi);
    setReportDescription(locale === 'en' ? tpl.descriptionEn : tpl.descriptionVi);
    setVisibility('PRIVATE');
    setSharedRoles([]);
    setIsTemplate(false);
    setDirty(true);
    setResult(null);
    setRunError(null);
    resetHistory(norm);
    setMobileTab('RESULT');
    setTabletDrawer('NONE');
    setViewMode('STUDIO');
    void executeReport(norm, 1);
  };

  const handleUpdateDef = (next: ReportDefinition) => {
    setDefinition(next);
    setDirty(true);
  };

  const handleChangePrimaryEntity = (entityId: EntityId) => {
    const fresh = createEmptyReportDefinition(entityId);
    handleUpdateDef(fresh);
    setResult(null);
  };

  const handleToggleRelated = (entityId: EntityId) => {
    const exists = definition.relatedEntities.includes(entityId);
    const nextRel = exists
      ? definition.relatedEntities.filter((e) => e !== entityId)
      : [...definition.relatedEntities, entityId];
    handleUpdateDef({ ...definition, relatedEntities: nextRel });
  };

  const handleQuickAdd = (field: FieldMeta, zone: DropZoneName) => {
    const updated = addFieldToZone(definition, field, zone);
    if (updated) handleUpdateDef(updated);
  };

  const handleSave = async () => {
    if (!activeReportId) {
      setShareModalState({ open: true, mode: 'SAVE_AS' });
      return;
    }
    setSaving(true);
    try {
      const res = await request<{ report: CustomReportRecord }>(
        `/api/organizations/${organizationId}/reports/builder/library/${activeReportId}`,
        {
          name: reportName.trim() || msg.library.newBlankReport,
          description: reportDescription,
          definition,
          visualizationType: definition.visualizationType,
          visibility,
          sharedRoles,
          isTemplate,
        },
        'PATCH',
      );
      setDirty(false);
      setNotice(msg.toolbar.savedSuccess);
      setLibraryReports((prev) => prev.map((r) => (r.id === res.report.id ? res.report : r)));
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleModalSaveSubmit = async (payload: {
    name: string;
    description: string;
    changeNote: string;
    visibility: 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE';
    sharedRoles: Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>;
    isTemplate: boolean;
  }) => {
    setSaving(true);
    try {
      if (shareModalState.mode === 'SHARE' && shareModalState.targetReport) {
        const target = shareModalState.targetReport;
        const res = await request<{ report: CustomReportRecord }>(
          `/api/organizations/${organizationId}/reports/builder/library/${target.id}`,
          {
            name: payload.name,
            description: payload.description,
            visibility: payload.visibility,
            sharedRoles: payload.sharedRoles,
            isTemplate: payload.isTemplate,
            changeNote: payload.changeNote || undefined,
          },
          'PATCH',
        );
        setLibraryReports((prev) => prev.map((r) => (r.id === res.report.id ? res.report : r)));
        if (activeReportId === res.report.id) {
          setReportName(res.report.name);
          setVisibility(res.report.visibility);
          setSharedRoles(res.report.sharedRoles);
          setIsTemplate(res.report.isTemplate);
        }
      } else if (shareModalState.mode === 'SHARE' && activeReportId) {
        const res = await request<{ report: CustomReportRecord }>(
          `/api/organizations/${organizationId}/reports/builder/library/${activeReportId}`,
          {
            name: payload.name,
            description: payload.description,
            definition,
            visualizationType: definition.visualizationType,
            visibility: payload.visibility,
            sharedRoles: payload.sharedRoles,
            isTemplate: payload.isTemplate,
            changeNote: payload.changeNote || undefined,
          },
          'PATCH',
        );
        setReportName(res.report.name);
        setVisibility(res.report.visibility);
        setSharedRoles(res.report.sharedRoles);
        setIsTemplate(res.report.isTemplate);
        setDirty(false);
        setLibraryReports((prev) => prev.map((r) => (r.id === res.report.id ? res.report : r)));
      } else {
        const res = await request<{ report: CustomReportRecord }>(
          `/api/organizations/${organizationId}/reports/builder/library`,
          {
            name: payload.name,
            description: payload.description,
            definition,
            visualizationType: definition.visualizationType,
            visibility: payload.visibility,
            sharedRoles: payload.sharedRoles,
            isTemplate: payload.isTemplate,
            changeNote: payload.changeNote || undefined,
          },
          'POST',
        );
        setActiveReportId(res.report.id);
        setReportName(res.report.name);
        setReportDescription(res.report.description ?? '');
        setVisibility(res.report.visibility);
        setSharedRoles(res.report.sharedRoles);
        setIsTemplate(res.report.isTemplate);
        setDirty(false);
        setLibraryReports((prev) => [res.report, ...prev]);
      }
      setNotice(msg.toolbar.savedSuccess);
      setShareModalState({ open: false, mode: 'SAVE_AS' });
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (report: CustomReportRecord) => {
    try {
      const res = await request<{ report: CustomReportRecord }>(
        `/api/organizations/${organizationId}/reports/builder/library/${report.id}/duplicate`,
        { name: `${report.name} (Copy)` },
        'POST',
      );
      setLibraryReports((prev) => [res.report, ...prev]);
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const handleDelete = async (report: CustomReportRecord) => {
    if (!window.confirm(msg.library.confirmDelete)) return;
    try {
      await request(
        `/api/organizations/${organizationId}/reports/builder/library/${report.id}`,
        {},
        'DELETE',
      );
      setLibraryReports((prev) => prev.filter((r) => r.id !== report.id));
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const handleToggleFavorite = async (report: CustomReportRecord) => {
    try {
      const res = await request<{ isFavorite: boolean }>(
        `/api/organizations/${organizationId}/reports/builder/library/${report.id}/favorite`,
        { isFavorite: !report.isFavorite },
        'POST',
      );
      setLibraryReports((prev) =>
        prev.map((r) => (r.id === report.id ? { ...r, isFavorite: res.isFavorite } : r)),
      );
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const handleSyncExport = async (format: 'CSV' | 'EXCEL' | 'PDF') => {
    setExportOpen(false);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/reports/builder/export`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          reportName: reportName || msg.studioTitle,
          format,
          locale,
          definition,
        }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({ code: 'EXPORT_FAILED' }))) as {
          code?: string;
        };
        throw new ApiError(response.status, errData.code || 'EXPORT_FAILED');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'EXCEL' ? 'xlsx' : format === 'PDF' ? 'pdf' : 'csv';
      a.href = url;
      a.download = `${(reportName || 'custom-report').replace(/\s+/g, '-')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const handleAsyncExport = async (format: 'CSV' | 'EXCEL' | 'PDF') => {
    setExportOpen(false);
    try {
      const created = await request<{ jobId: string; status: ExportJobState['status'] }>(
        `/api/organizations/${organizationId}/reports/builder/export-jobs`,
        {
          reportId: activeReportId ?? undefined,
          reportName: reportName || msg.studioTitle,
          format,
          locale,
          definition,
        },
        'POST',
      );
      setExportJob({
        id: created.jobId,
        format,
        status: created.status,
        rowCount: 0,
        fileName: null,
        errorCode: null,
      });

      const poll = async (attempts = 0) => {
        if (attempts > 25) return;
        const job = await request<ExportJobState>(
          `/api/organizations/${organizationId}/reports/builder/export-jobs/${created.jobId}`,
        );
        setExportJob(job);
        if (job.status === 'PENDING' || job.status === 'PROCESSING') {
          window.setTimeout(() => void poll(attempts + 1), 600);
        }
      };
      window.setTimeout(() => void poll(0), 400);
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const startPanelResize = (side: 'left' | 'right', startX: number, initial: number) => {
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (side === 'left') {
        setLeftWidth(Math.max(220, Math.min(400, initial + delta)));
      } else {
        setRightWidth(Math.max(260, Math.min(440, initial - delta)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (viewMode === 'LIBRARY') {
    return (
      <>
        {notice && (
          <div className="rbs-pill warning" role="status">
            {notice}
          </div>
        )}
        <CustomReportsLibrary
          locale={locale}
          msg={msg}
          currentUserId={currentUserId}
          entities={entities}
          reports={libraryReports}
          templates={templates}
          loading={libraryLoading}
          onCreateBlank={openBlankInStudio}
          onOpenReport={openReportInStudio}
          onUseTemplate={openTemplateInStudio}
          onDuplicateReport={handleDuplicate}
          onDeleteReport={handleDelete}
          onToggleFavorite={handleToggleFavorite}
          onShareReport={(rep) =>
            setShareModalState({ open: true, mode: 'SHARE', targetReport: rep })
          }
        />
        {shareModalState.open && (
          <ShareReportModal
            msg={msg}
            mode={shareModalState.mode}
            initialName={shareModalState.targetReport?.name ?? reportName}
            initialDescription={shareModalState.targetReport?.description ?? reportDescription}
            initialVisibility={shareModalState.targetReport?.visibility ?? visibility}
            initialSharedRoles={shareModalState.targetReport?.sharedRoles ?? sharedRoles}
            initialIsTemplate={shareModalState.targetReport?.isTemplate ?? isTemplate}
            canPublishTemplate={userRole === 'ADMIN' || userRole === 'HR'}
            submitting={saving}
            onSubmit={handleModalSaveSubmit}
            onClose={() => setShareModalState({ open: false, mode: 'SAVE_AS' })}
          />
        )}
      </>
    );
  }

  const countFilters = (g: ReportDefinition['filters']): number =>
    g.rules.length + g.groups.reduce((s, sub) => s + countFilters(sub), 0);
  const filterCount = countFilters(definition.filters);
  const totalConfigCount =
    definition.columns.length +
    definition.rows.length +
    definition.groupBy.length +
    definition.pivotColumns.length +
    definition.values.length +
    definition.sortBy.length +
    filterCount;

  const runReportAndFocusResult = () => {
    setTabletDrawer('NONE');
    setMobileTab('RESULT');
    void executeReport(definition, 1, false);
  };

  const assignQuickFieldToZone = (field: FieldMeta, zone: DropZoneName) => {
    const updated = addFieldToZone(definition, field, zone);
    if (updated) {
      handleUpdateDef(updated);
      const label = locale === 'en' ? field.labelEn : field.labelVi;
      setNotice(
        msg.responsive.addedNotice
          .replace('{field}', label)
          .replace('{zone}', msg.config.zones[zone]),
      );
    }
    setQuickAssignField(null);
  };

  return (
    <div className={`rbs-shell ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="rbs-studio-frame">
        {/* Clean Minimal Studio Top Bar matching SaaS Mockup */}
        <div className="rbs-toolbar">
          <div className="rbs-toolbar-left">
            <button
              type="button"
              className="rbs-btn ghost"
              onClick={() => {
                setViewMode('LIBRARY');
                void loadMetadataAndLibrary();
              }}
            >
              {`← ${msg.backToLibrary}`}
            </button>
            <span className="rbs-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
            <input
              type="text"
              className="rbs-name-input"
              aria-label={msg.toolbar.reportNameLabel}
              placeholder={msg.toolbar.reportNamePlaceholder}
              value={reportName}
              onChange={(e) => {
                setReportName(e.target.value);
                setDirty(true);
              }}
            />
            {dirty && <span className="rbs-pill warning">{msg.toolbar.unsavedChanges}</span>}
          </div>

          <div className="rbs-toolbar-right">
            {/* Desktop-only: undo / redo inline buttons */}
            <button
              type="button"
              className="rbs-btn ghost rbs-desktop-only-btn"
              disabled={!canUndo}
              onClick={undo}
              title={msg.toolbar.undo}
            >
              {msg.toolbar.undo}
            </button>
            <button
              type="button"
              className="rbs-btn ghost rbs-desktop-only-btn"
              disabled={!canRedo}
              onClick={redo}
              title={msg.toolbar.redo}
            >
              {msg.toolbar.redo}
            </button>

            {/* Each wrapper is a grid cell; position:relative kept for dropdown anchor */}
            <div className="rbs-toolbar-action-cell rbs-export-menu-wrap">
              <button
                type="button"
                className="rbs-btn rbs-toolbar-action-btn"
                aria-expanded={exportOpen}
                onClick={() => {
                  setExportOpen((o) => !o);
                  setMoreOpen(false);
                }}
              >
                <span className="rbs-btn-label">{msg.toolbar.exportBtn}</span>
                <span className="rbs-btn-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {exportOpen && (
                <div className="rbs-dropdown-menu" role="menu">
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => void handleSyncExport('CSV')}
                  >
                    {msg.toolbar.exportCsv}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => void handleSyncExport('EXCEL')}
                  >
                    {msg.toolbar.exportExcel}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => void handleSyncExport('PDF')}
                  >
                    {msg.toolbar.exportPdf}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => void handleAsyncExport('EXCEL')}
                  >
                    {msg.toolbar.exportAsync}
                  </button>
                </div>
              )}
            </div>

            <div className="rbs-toolbar-action-cell rbs-export-menu-wrap">
              <button
                type="button"
                className="rbs-btn rbs-toolbar-action-btn"
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen((o) => !o);
                  setExportOpen(false);
                }}
              >
                <span className="rbs-btn-label">{msg.toolbar.moreActions}</span>
                <span className="rbs-btn-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {moreOpen && (
                <div className="rbs-dropdown-menu" role="menu">
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    disabled={!canUndo}
                    onClick={() => {
                      setMoreOpen(false);
                      undo();
                    }}
                  >
                    {msg.toolbar.undo}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    disabled={!canRedo}
                    onClick={() => {
                      setMoreOpen(false);
                      redo();
                    }}
                  >
                    {msg.toolbar.redo}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      setShareModalState({ open: true, mode: 'SAVE_AS' });
                    }}
                  >
                    {msg.toolbar.saveAs}
                  </button>
                  {activeReportId && (
                    <button
                      type="button"
                      className="rbs-dropdown-item"
                      onClick={() => {
                        setMoreOpen(false);
                        setShareModalState({ open: true, mode: 'SHARE' });
                      }}
                    >
                      {msg.toolbar.share}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      void executeReport(definition, 1, true);
                    }}
                  >
                    {msg.toolbar.refresh}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      const fresh = createEmptyReportDefinition(definition.primaryEntity);
                      handleUpdateDef(fresh);
                      setResult(null);
                    }}
                  >
                    {msg.toolbar.reset}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      setShowExplorer((v) => !v);
                    }}
                  >
                    {msg.toolbar.toggleExplorer}
                  </button>
                  <button
                    type="button"
                    className="rbs-dropdown-item"
                    onClick={() => {
                      setMoreOpen(false);
                      setShowConfig((v) => !v);
                    }}
                  >
                    {msg.toolbar.toggleConfig}
                  </button>
                </div>
              )}
            </div>

            <div className="rbs-toolbar-action-cell">
              <button
                type="button"
                className="rbs-btn primary rbs-toolbar-action-btn"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                <span className="rbs-btn-label">
                  {saving ? msg.toolbar.saving : msg.toolbar.save}
                </span>
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className="rbs-pill brand" role="status" style={{ margin: '8px 16px 0' }}>
            {notice}
          </div>
        )}

        {exportJob && (
          <div
            className="rbs-pill brand"
            style={{ justifyContent: 'space-between', margin: '8px 16px 0' }}
          >
            <span>
              {exportJob.status === 'COMPLETED'
                ? `${msg.toolbar.exportJobDone} (${exportJob.rowCount})`
                : msg.toolbar.exportJobPending}
            </span>
            {exportJob.status === 'COMPLETED' && (
              <a
                href={`/api/organizations/${organizationId}/reports/builder/export-jobs/${exportJob.id}/download`}
                className="rbs-btn sm primary"
              >
                {msg.toolbar.exportJobDownload}
              </a>
            )}
          </div>
        )}

        {/* Mobile 3-Tab Workspace Switcher (<= 767px) */}
        <div className="rbs-mobile-switcher" role="tablist" aria-label={msg.studioTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'DATA'}
            className={`rbs-mobile-tab-btn ${mobileTab === 'DATA' ? 'active' : ''}`}
            onClick={() => setMobileTab('DATA')}
          >
            {msg.responsive.tabData}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'CONFIG'}
            className={`rbs-mobile-tab-btn ${mobileTab === 'CONFIG' ? 'active' : ''}`}
            onClick={() => setMobileTab('CONFIG')}
          >
            {`${msg.responsive.tabConfig} (${totalConfigCount})`}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'RESULT'}
            className={`rbs-mobile-tab-btn ${mobileTab === 'RESULT' ? 'active' : ''}`}
            onClick={() => setMobileTab('RESULT')}
          >
            {msg.responsive.tabResult}
          </button>
        </div>

        {/* Tablet Slide-Over Drawer Controls (768px - 1120px) */}
        <div className="rbs-tablet-drawer-bar">
          <button
            type="button"
            className={`rbs-btn sm ${tabletDrawer === 'DATA' ? 'primary' : ''}`}
            onClick={() => setTabletDrawer((d) => (d === 'DATA' ? 'NONE' : 'DATA'))}
          >
            {msg.explorer.title}
          </button>
          <button
            type="button"
            className={`rbs-btn sm ${tabletDrawer === 'CONFIG' ? 'primary' : ''}`}
            onClick={() => setTabletDrawer((d) => (d === 'CONFIG' ? 'NONE' : 'CONFIG'))}
          >
            {`${msg.config.title} (${totalConfigCount})`}
          </button>
        </div>

        {/* 3-Panel Resizable Workspace */}
        <div
          className="rbs-workspace"
          data-mobile-tab={mobileTab}
          data-tablet-drawer={tabletDrawer}
          style={
            {
              '--rbs-left-w': `${leftWidth}px`,
              '--rbs-right-w': `${rightWidth}px`,
            } as CSSProperties
          }
        >
          {tabletDrawer !== 'NONE' && (
            <div
              className="rbs-drawer-backdrop"
              aria-hidden="true"
              onClick={() => setTabletDrawer('NONE')}
            />
          )}

          {showExplorer && (
            <>
              <div className="rbs-panel-slot-left">
                <DataExplorerPanel
                  locale={locale}
                  msg={msg}
                  entities={entities}
                  fields={fields}
                  primaryEntity={definition.primaryEntity}
                  relatedEntities={definition.relatedEntities}
                  calculatedFields={definition.calculatedFields}
                  onChangePrimaryEntity={handleChangePrimaryEntity}
                  onToggleRelatedEntity={handleToggleRelated}
                  onQuickAddField={handleQuickAdd}
                  onTapField={(field) => setQuickAssignField(field)}
                  onCloseDrawer={() => setTabletDrawer('NONE')}
                  onOpenFormulaModal={(editing) => setFormulaModalState({ open: true, editing })}
                  onDeleteCalculatedField={(id) =>
                    handleUpdateDef({
                      ...definition,
                      calculatedFields: definition.calculatedFields.filter((c) => c.id !== id),
                    })
                  }
                />
              </div>
              <div
                className="rbs-resizer"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(e) => startPanelResize('left', e.clientX, leftWidth)}
              />
            </>
          )}

          <ReportCanvasPanel
            locale={locale}
            msg={msg}
            reportName={reportName}
            definition={definition}
            result={result}
            loading={running}
            error={runError}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((f) => !f)}
            onChangeVizType={(viz) => {
              const next = { ...definition, visualizationType: viz };
              handleUpdateDef(next);
              void executeReport(next, 1, false);
            }}
            onSortColumn={(fieldId) => {
              const cur = definition.sortBy[0];
              const dir = cur?.fieldId === fieldId && cur.direction === 'ASC' ? 'DESC' : 'ASC';
              const next = {
                ...definition,
                sortBy: [{ fieldId, direction: dir as 'ASC' | 'DESC' }],
              };
              handleUpdateDef(next);
              void executeReport(next, 1, false);
            }}
            onChangePage={(page) => void executeReport(definition, page, false)}
            onChangePageSize={(pageSize) => {
              const next = { ...definition, pageSize };
              handleUpdateDef(next);
              void executeReport(next, 1, false);
            }}
            onRetry={() => void executeReport(definition, 1, true)}
            onRunReport={runReportAndFocusResult}
            onDrilldown={async (dimFilters) => {
              const res = await request<{
                columns: ResultColumn[];
                rows: Array<Record<string, unknown>>;
                totalRows: number;
              }>(
                `/api/organizations/${organizationId}/reports/builder/drilldown`,
                { definition, dimensionFilters: dimFilters, page: 1, pageSize: 50, locale },
                'POST',
              );
              return res;
            }}
          />

          {showConfig && (
            <>
              <div
                className="rbs-resizer"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(e) => startPanelResize('right', e.clientX, rightWidth)}
              />
              <div className="rbs-panel-slot-right">
                <ReportConfigPanel
                  locale={locale}
                  msg={msg}
                  definition={definition}
                  fieldMap={fieldMap}
                  availableFields={availableFieldsForActive}
                  running={running}
                  onChangeDefinition={handleUpdateDef}
                  onOpenFilterBuilder={() => setFilterOpen(true)}
                  onRunReport={runReportAndFocusResult}
                  onCloseDrawer={() => setTabletDrawer('NONE')}
                />
              </div>
            </>
          )}
        </div>

        {/* Sticky Mobile Thumb-Zone Bottom Bar (<= 767px) */}
        <div className="rbs-mobile-bottom-bar">
          <button type="button" className="rbs-btn" onClick={() => setFilterOpen(true)}>
            {`${msg.responsive.filterCountBtn} (${filterCount})`}
          </button>
          <button
            type="button"
            className="rbs-btn primary"
            disabled={running}
            onClick={runReportAndFocusResult}
          >
            {running ? msg.toolbar.running : msg.toolbar.runReport}
          </button>
        </div>
      </div>

      {quickAssignField && (
        <SlideDialog
          label={msg.responsive.addToZoneTitle}
          onClose={() => setQuickAssignField(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {locale === 'en' ? quickAssignField.labelEn : quickAssignField.labelVi}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                {locale === 'en' ? quickAssignField.descriptionEn : quickAssignField.descriptionVi}
              </p>
            </div>
            <div className="rbs-label">{msg.responsive.addToZoneTitle}</div>
            <div className="rbs-quick-zone-grid">
              {(['columns', 'rows', 'groupBy', 'pivotColumns', 'values', 'sortBy'] as const).map(
                (zone) => (
                  <button
                    key={zone}
                    type="button"
                    className="rbs-quick-zone-btn"
                    disabled={!canDropFieldInZone(quickAssignField, zone)}
                    onClick={() => assignQuickFieldToZone(quickAssignField, zone)}
                  >
                    {msg.config.zones[zone]}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="rbs-btn"
              onClick={() => {
                const f = quickAssignField;
                setQuickAssignField(null);
                const newRule = {
                  id: `r_${Date.now().toString(36)}`,
                  fieldId: f.id,
                  operator: f.filterOperators[0] ?? 'eq',
                  value: '',
                };
                handleUpdateDef({
                  ...definition,
                  filters: {
                    ...definition.filters,
                    rules: [...definition.filters.rules, newRule],
                  },
                });
                setFilterOpen(true);
              }}
            >
              {msg.responsive.addToFilter}
            </button>
          </div>
        </SlideDialog>
      )}

      {formulaModalState.open && (
        <CalculatedFieldModal
          locale={locale}
          msg={msg}
          availableFields={availableFieldsForActive}
          measureIds={definition.values.map((v) => v.id)}
          initial={formulaModalState.editing}
          onValidate={async (formula) =>
            request<{ valid: boolean; resultType?: string; errorMessage?: string }>(
              `/api/organizations/${organizationId}/reports/builder/validate-formula`,
              {
                primaryEntity: definition.primaryEntity,
                relatedEntities: definition.relatedEntities,
                formula,
                measureIds: definition.values.map((v) => v.id),
              },
              'POST',
            )
          }
          onSave={(cf) => {
            const exists = definition.calculatedFields.some((c) => c.id === cf.id);
            const nextList = exists
              ? definition.calculatedFields.map((c) => (c.id === cf.id ? cf : c))
              : [...definition.calculatedFields, cf];
            handleUpdateDef({ ...definition, calculatedFields: nextList });
            setFormulaModalState({ open: false });
          }}
          onClose={() => setFormulaModalState({ open: false })}
        />
      )}

      {filterOpen && (
        <AdvancedFilterBuilder
          locale={locale}
          msg={msg}
          availableFields={availableFieldsForActive}
          rootGroup={definition.filters}
          onApply={(nextFilters) => {
            const next = { ...definition, filters: nextFilters };
            handleUpdateDef(next);
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {shareModalState.open && (
        <ShareReportModal
          msg={msg}
          mode={shareModalState.mode}
          initialName={shareModalState.targetReport?.name ?? reportName}
          initialDescription={shareModalState.targetReport?.description ?? reportDescription}
          initialVisibility={shareModalState.targetReport?.visibility ?? visibility}
          initialSharedRoles={shareModalState.targetReport?.sharedRoles ?? sharedRoles}
          initialIsTemplate={shareModalState.targetReport?.isTemplate ?? isTemplate}
          canPublishTemplate={userRole === 'ADMIN' || userRole === 'HR'}
          submitting={saving}
          onSubmit={handleModalSaveSubmit}
          onClose={() => setShareModalState({ open: false, mode: 'SAVE_AS' })}
        />
      )}
    </div>
  );
}
