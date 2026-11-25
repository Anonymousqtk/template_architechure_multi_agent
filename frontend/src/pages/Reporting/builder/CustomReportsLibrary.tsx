import { useMemo, useState } from 'react';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';
import { ReportLibraryCard, ReportCardArrow } from './ReportLibraryCard';
import type { CustomReportRecord, EntityMeta, PrebuiltTemplate } from './reportBuilderTypes';

type LibrarySection = 'MY' | 'SHARED' | 'TEMPLATES' | 'FAVORITES' | 'RECENT';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  currentUserId: string;
  entities: EntityMeta[];
  reports: CustomReportRecord[];
  templates: PrebuiltTemplate[];
  loading: boolean;
  onCreateBlank: () => void;
  onCreateGuided: () => void;
  onOpenReport: (report: CustomReportRecord) => void;
  onUseTemplate: (template: PrebuiltTemplate) => void;
  onDuplicateReport: (report: CustomReportRecord) => void;
  onDeleteReport: (report: CustomReportRecord) => void;
  onToggleFavorite: (report: CustomReportRecord) => void;
  onShareReport: (report: CustomReportRecord) => void;
}

export function CustomReportsLibrary({
  locale,
  msg,
  currentUserId,
  entities,
  reports,
  templates,
  loading,
  onCreateBlank,
  onCreateGuided,
  onOpenReport,
  onUseTemplate,
  onDuplicateReport,
  onDeleteReport,
  onToggleFavorite,
  onShareReport,
}: Props) {
  const guide = reportBuilderGuideMessages[locale];
  const [section, setSection] = useState<LibrarySection>('MY');
  const [query, setQuery] = useState('');

  const entityMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = reports;
    if (section === 'MY') {
      base = reports.filter((r) => r.createdBy === currentUserId && !r.isTemplate);
    } else if (section === 'SHARED') {
      base = reports.filter(
        (r) =>
          (r.visibility === 'SHARED' || r.visibility === 'ORG_TEMPLATE') &&
          r.createdBy !== currentUserId,
      );
    } else if (section === 'FAVORITES') {
      base = reports.filter((r) => r.isFavorite);
    } else if (section === 'RECENT') {
      base = [...reports]
        .filter((r) => Boolean(r.lastViewedAt || r.lastRunAt))
        .sort((a, b) =>
          String(b.lastViewedAt ?? b.lastRunAt ?? '').localeCompare(
            String(a.lastViewedAt ?? a.lastRunAt ?? ''),
          ),
        );
    } else if (section === 'TEMPLATES') {
      base = reports.filter((r) => r.isTemplate || r.visibility === 'ORG_TEMPLATE');
    }

    if (!q) return base;
    return base.filter((r) => {
      const entity = entityMap.get(r.primaryEntity);
      const entityName = entity ? (locale === 'en' ? entity.labelEn : entity.labelVi) : '';
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        entityName.toLowerCase().includes(q)
      );
    });
  }, [reports, section, query, currentUserId, entityMap, locale]);

  const filteredTemplates = useMemo(() => {
    if (section !== 'TEMPLATES') return [];
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const n = locale === 'en' ? t.nameEn : t.nameVi;
      const d = locale === 'en' ? t.descriptionEn : t.descriptionVi;
      return n.toLowerCase().includes(q) || d.toLowerCase().includes(q);
    });
  }, [section, query, templates, locale]);

  const sections: Array<{ key: LibrarySection; label: string }> = [
    { key: 'MY', label: msg.library.myReports },
    { key: 'SHARED', label: msg.library.sharedReports },
    { key: 'TEMPLATES', label: msg.library.templates },
    { key: 'FAVORITES', label: msg.library.favorites },
    { key: 'RECENT', label: msg.library.recent },
  ];

  const getVisibilityLabel = (v: CustomReportRecord['visibility']) => {
    if (v === 'ORG_TEMPLATE') return msg.library.visibilityTemplate;
    if (v === 'SHARED') return msg.library.visibilityShared;
    return msg.library.visibilityPrivate;
  };

  return (
    <div className="rbs-shell">
      <section className="rbs-library-intro" aria-label={guide.introTitle}>
        <h2>{guide.introTitle}</h2>
        <p>{guide.introBody}</p>
        <div className="rbs-guide-options">
          <button
            type="button"
            className="rbs-guide-choice"
            onClick={() => setSection('TEMPLATES')}
          >
            <strong>{guide.templates}</strong>
            <span>{guide.templatesHint}</span>
          </button>
          <button
            type="button"
            className="rbs-guide-choice"
            disabled={loading}
            onClick={onCreateGuided}
          >
            <strong>{guide.guided}</strong>
            <span>{guide.guidedHint}</span>
          </button>
          <button
            type="button"
            className="rbs-guide-choice"
            disabled={loading}
            onClick={onCreateBlank}
          >
            <strong>{guide.advanced}</strong>
            <span>{guide.advancedHint}</span>
          </button>
        </div>
      </section>
      <div className="rbs-library-bar">
        <div className="rbs-lib-tabs" role="tablist" aria-label={msg.backToLibrary}>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={section === s.key}
              className={`rbs-lib-tab ${section === s.key ? 'active' : ''}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="rbs-library-bar-actions">
          <div className="rbs-lib-search-wrap">
            <span className="rbs-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              className="rbs-library-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={msg.library.searchPlaceholder}
              aria-label={msg.library.searchPlaceholder}
            />
          </div>
          <button
            type="button"
            className="rbs-btn primary"
            disabled={loading}
            onClick={onCreateGuided}
          >
            {`+ ${guide.guided}`}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rbs-status-box">{msg.common.loading}</div>
      ) : (
        <>
          {section === 'TEMPLATES' && filteredTemplates.length > 0 && (
            <div className="rbs-library-grid">
              {filteredTemplates.map((tpl) => {
                const entity = entityMap.get(tpl.definition.primaryEntity);
                return (
                  <ReportLibraryCard
                    key={tpl.code}
                    locale={locale}
                    title={locale === 'en' ? tpl.nameEn : tpl.nameVi}
                    description={locale === 'en' ? tpl.descriptionEn : tpl.descriptionVi}
                    source={
                      entity ? (locale === 'en' ? entity.labelEn : entity.labelVi) : undefined
                    }
                    visualization={msg.canvas.views[tpl.visualizationType]}
                  >
                    <button
                      type="button"
                      className="rbs-btn rbs-card-cta"
                      onClick={() => onUseTemplate(tpl)}
                    >
                      {msg.library.useTemplate}
                      <ReportCardArrow />
                    </button>
                  </ReportLibraryCard>
                );
              })}
            </div>
          )}

          {filteredReports.length === 0 && filteredTemplates.length === 0 ? (
            <div className="rbs-status-box">
              <h3>{msg.library.emptyTitle}</h3>
              <p style={{ color: 'var(--text-muted, #64748b)' }}>{guide.guidedHint}</p>
              <button
                type="button"
                className="rbs-btn primary"
                style={{ marginTop: '0.75rem' }}
                onClick={onCreateGuided}
              >
                {guide.guided}
              </button>
            </div>
          ) : (
            <div className="rbs-library-grid">
              {filteredReports.map((rep) => {
                const entity = entityMap.get(rep.primaryEntity);
                return (
                  <ReportLibraryCard
                    key={rep.id}
                    locale={locale}
                    title={rep.name}
                    description={rep.description ?? undefined}
                    source={
                      entity ? (locale === 'en' ? entity.labelEn : entity.labelVi) : undefined
                    }
                    visualization={msg.canvas.views[rep.visualizationType] ?? rep.visualizationType}
                    headingAction={
                      <button
                        type="button"
                        className="rbs-btn rbs-card-favorite"
                        aria-pressed={rep.isFavorite}
                        onClick={() => onToggleFavorite(rep)}
                        aria-label={
                          rep.isFavorite ? msg.library.favoriteRemove : msg.library.favoriteAdd
                        }
                        title={
                          rep.isFavorite ? msg.library.favoriteRemove : msg.library.favoriteAdd
                        }
                      >
                        {rep.isFavorite ? '★' : '☆'}
                      </button>
                    }
                    metadata={
                      <>
                        <span>{getVisibilityLabel(rep.visibility)}</span>
                        <span>{`${msg.library.versionBadge} v${rep.version}`}</span>
                      </>
                    }
                  >
                    <button
                      type="button"
                      className="rbs-btn rbs-card-cta"
                      onClick={() => onOpenReport(rep)}
                    >
                      {msg.library.openBtn}
                      <ReportCardArrow />
                    </button>
                    <button
                      type="button"
                      className="rbs-btn"
                      onClick={() => onDuplicateReport(rep)}
                    >
                      {msg.library.duplicateBtn}
                    </button>
                    {rep.createdBy === currentUserId && (
                      <>
                        <button
                          type="button"
                          className="rbs-btn"
                          onClick={() => onShareReport(rep)}
                        >
                          {msg.library.shareBtn}
                        </button>
                        <button
                          type="button"
                          className="rbs-btn rbs-card-danger"
                          onClick={() => onDeleteReport(rep)}
                        >
                          {msg.library.deleteBtn}
                        </button>
                      </>
                    )}
                  </ReportLibraryCard>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
