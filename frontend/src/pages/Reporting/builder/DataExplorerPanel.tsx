import { useMemo, useState } from 'react';
import { SearchableSelect } from '../../../components/common/SearchableSelect';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';
import { FieldGuide, sourceGrain } from './ReportGuideInfo';
import type {
  CalculatedFieldConfig,
  DropZoneName,
  EntityId,
  EntityMeta,
  FieldDataType,
  FieldMeta,
} from './reportBuilderTypes';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  entities: EntityMeta[];
  fields: FieldMeta[];
  primaryEntity: EntityId;
  relatedEntities: EntityId[];
  calculatedFields: CalculatedFieldConfig[];
  onChangePrimaryEntity: (entityId: EntityId) => void;
  onToggleRelatedEntity: (entityId: EntityId) => void;
  onQuickAddField: (field: FieldMeta, zone: DropZoneName) => void;
  onOpenFormulaModal: (editing?: CalculatedFieldConfig) => void;
  onDeleteCalculatedField: (id: string) => void;
  onTapField?: (field: FieldMeta) => void;
  onCloseDrawer?: () => void;
}

const TYPE_ICONS: Record<FieldDataType, string> = {
  string: 'T',
  number: '#',
  currency: '₫',
  date: '◷',
  boolean: '✓',
  enum: '☰',
};

export function DataExplorerPanel({
  locale,
  msg,
  entities,
  fields,
  primaryEntity,
  relatedEntities,
  calculatedFields,
  onChangePrimaryEntity,
  onToggleRelatedEntity,
  onQuickAddField,
  onOpenFormulaModal,
  onDeleteCalculatedField,
  onTapField,
  onCloseDrawer,
}: Props) {
  const guide = reportBuilderGuideMessages[locale];
  const [search, setSearch] = useState('');
  const [showRelated, setShowRelated] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [quickTargetZone, setQuickTargetZone] = useState<DropZoneName>('columns');

  const activeEntityMeta = useMemo(
    () => entities.find((e) => e.id === primaryEntity) ?? entities[0],
    [entities, primaryEntity],
  );

  const entityOptions = useMemo(
    () =>
      entities.map((e) => ({
        value: e.id,
        label: `${msg.explorer.sourcePrefix}: ${locale === 'en' ? e.labelEn : e.labelVi}`,
      })),
    [entities, locale, msg.explorer.sourcePrefix],
  );

  const availableEntities = useMemo(
    () => new Set<EntityId>([primaryEntity, ...relatedEntities]),
    [primaryEntity, relatedEntities],
  );

  const groupedFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, FieldMeta[]>();
    for (const f of fields) {
      if (!availableEntities.has(f.entity)) continue;
      const label = locale === 'en' ? f.labelEn : f.labelVi;
      const cat = locale === 'en' ? f.categoryEn : f.categoryVi;
      if (
        q &&
        !label.toLowerCase().includes(q) &&
        !cat.toLowerCase().includes(q) &&
        !f.id.includes(q)
      ) {
        continue;
      }
      const list = groups.get(cat) ?? [];
      list.push(f);
      groups.set(cat, list);
    }
    return [...groups.entries()];
  }, [fields, availableEntities, search, locale]);

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <aside className="rbs-panel rbs-panel-left" aria-label={msg.explorer.title}>
      <div className="rbs-panel-header">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div>
            <h2>{msg.explorer.title}</h2>
            <p className="rbs-panel-subtitle">{msg.responsive.tapFieldHint}</p>
          </div>
          {onCloseDrawer && (
            <button
              type="button"
              className="rbs-btn sm icon-only rbs-drawer-close"
              aria-label={msg.responsive.closePanel}
              onClick={onCloseDrawer}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="rbs-panel-scroll">
        <div>
          <SearchableSelect
            id="rbs-primary-entity"
            value={primaryEntity}
            options={entityOptions}
            onChange={(val) => onChangePrimaryEntity(val as EntityId)}
            ariaLabel={msg.explorer.primaryEntity}
            searchPlaceholder={msg.explorer.searchFields}
          />
          {activeEntityMeta && (
            <div className="rbs-guide-note">
              <p>
                {locale === 'en' ? activeEntityMeta.descriptionEn : activeEntityMeta.descriptionVi}
              </p>
              <p>
                {guide.grainLabel}: {sourceGrain(activeEntityMeta.id, locale)}
              </p>
            </div>
          )}
        </div>

        {activeEntityMeta && activeEntityMeta.relatedEntities.length > 0 && (
          <div>
            <button
              type="button"
              className="rbs-related-toggle"
              aria-expanded={showRelated}
              onClick={() => setShowRelated((s) => !s)}
            >
              <span>{`${msg.explorer.toggleRelated} (${relatedEntities.length})`}</span>
              <span>{showRelated ? '▴' : '▾'}</span>
            </button>
            {showRelated && (
              <div className="rbs-related-list" style={{ marginTop: '6px' }}>
                <p className="rbs-guide-note">{guide.relatedHint}</p>
                {activeEntityMeta.relatedEntities.map((rel) => {
                  const target = entities.find((e) => e.id === rel.entity);
                  if (!target) return null;
                  return (
                    <label key={rel.entity} className="rbs-check-row">
                      <input
                        type="checkbox"
                        checked={relatedEntities.includes(rel.entity)}
                        onChange={() => onToggleRelatedEntity(rel.entity)}
                      />
                      <span>
                        <strong>{locale === 'en' ? target.labelEn : target.labelVi}</strong>
                        <br />
                        <small style={{ color: '#64748b' }}>
                          {locale === 'en' ? rel.joinDescriptionEn : rel.joinDescriptionVi}
                        </small>
                      </span>
                    </label>
                  );
                })}
                <p className="rbs-guide-note">{guide.unavailableJoin}</p>
              </div>
            )}
          </div>
        )}

        <div className="rbs-search-wrap">
          <span className="rbs-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id="rbs-field-search"
            type="search"
            className="rbs-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={msg.explorer.searchFields}
            aria-label={msg.explorer.searchFields}
          />
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-quick-target">
            {msg.explorer.dragHint}
          </label>
          <select
            id="rbs-quick-target"
            className="rbs-select"
            value={quickTargetZone}
            onChange={(e) => setQuickTargetZone(e.target.value as DropZoneName)}
          >
            <option value="columns">{msg.config.zones.columns}</option>
            <option value="rows">{msg.config.zones.rows}</option>
            <option value="pivotColumns">{msg.config.zones.pivotColumns}</option>
            <option value="values">{msg.config.zones.values}</option>
            <option value="groupBy">{msg.config.zones.groupBy}</option>
            <option value="sortBy">{msg.config.zones.sortBy}</option>
          </select>
        </div>

        {groupedFields.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: '#64748b' }}>{msg.explorer.noFieldsFound}</div>
        ) : (
          groupedFields.map(([cat, list]) => {
            const isCollapsed = Boolean(collapsedGroups[cat]);
            return (
              <div key={cat} className="rbs-group-section">
                <button
                  type="button"
                  className="rbs-group-heading"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(cat)}
                >
                  <span>{cat}</span>
                  <span>{isCollapsed ? '+' : '−'}</span>
                </button>
                {!isCollapsed && (
                  <div className="rbs-field-list">
                    {list.map((f) => {
                      const label = locale === 'en' ? f.labelEn : f.labelVi;
                      const desc = locale === 'en' ? f.descriptionEn : f.descriptionVi;
                      return (
                        <div key={f.id} className="rbs-field-entry">
                          <div
                            className="rbs-field-item"
                            draggable
                            title={desc}
                            onClick={() => onTapField?.(f)}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', f.id);
                              e.dataTransfer.effectAllowed = 'copy';
                            }}
                          >
                            <div className="rbs-field-main">
                              <span className="rbs-drag-grip" aria-hidden="true">
                                ⋮⋮
                              </span>
                              <span className="rbs-field-title">{label}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span
                                className="rbs-field-type-pill"
                                title={msg.explorer.types[f.dataType]}
                              >
                                {TYPE_ICONS[f.dataType]}
                              </span>
                              <button
                                type="button"
                                className="rbs-chip-btn"
                                aria-label={`${msg.explorer.quickAddColumns}: ${label}`}
                                title={msg.config.zones[quickTargetZone]}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onQuickAddField(f, quickTargetZone);
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <FieldGuide field={f} entities={entities} locale={locale} msg={msg} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="rbs-group-section">
          <div className="rbs-group-heading">
            <span>{msg.explorer.calculatedFieldsTitle}</span>
          </div>
          <div className="rbs-field-list">
            {calculatedFields.map((cf) => (
              <div key={cf.id} className="rbs-field-item">
                <div className="rbs-field-main">
                  <span className="rbs-field-type-pill">{'='}</span>
                  <span className="rbs-field-title" title={cf.formula}>
                    {cf.label}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button
                    type="button"
                    className="rbs-chip-btn"
                    aria-label={`${msg.explorer.editCalculatedField}: ${cf.label}`}
                    onClick={() => onOpenFormulaModal(cf)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="rbs-chip-btn"
                    aria-label={`${msg.explorer.deleteCalculatedField}: ${cf.label}`}
                    onClick={() => onDeleteCalculatedField(cf.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="rbs-add-inline-btn"
              onClick={() => onOpenFormulaModal(undefined)}
            >
              {`+ ${msg.explorer.addCalculatedField}`}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
