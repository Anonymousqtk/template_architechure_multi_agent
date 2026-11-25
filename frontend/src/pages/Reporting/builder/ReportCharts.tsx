import { useMemo, useState } from 'react';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import type {
  ReportDefinition,
  ReportExecutionResult,
  VisualizationType,
} from './reportBuilderTypes';
import { formatCellValue } from './useReportBuilderHistory';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  vizType: VisualizationType;
  definition: ReportDefinition;
  result: ReportExecutionResult;
}

const PALETTES: Record<string, string[]> = {
  default: ['#3b82f6', '#2563eb', '#0ea5e9', '#059669', '#d97706', '#7c3aed'],
  emerald: ['#10b981', '#059669', '#0d9488', '#0284c7', '#65a30d', '#f59e0b'],
  violet: ['#7c3aed', '#6366f1', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316'],
  warm: ['#d97706', '#ea580c', '#dc2626', '#eab308', '#0f766e', '#2563eb'],
};

export function ReportCharts({ locale, msg, vizType, definition, result }: Props) {
  const [hoveredText, setHoveredText] = useState<string | null>(null);
  const colors = PALETTES[definition.visualizationOptions.palette ?? 'default'] ?? PALETTES.default;
  const showLegend = definition.visualizationOptions.showLegend !== false;
  const showDataLabels = Boolean(definition.visualizationOptions.showDataLabels);

  const dims = useMemo(() => result.columns.filter((c) => !c.isMeasure), [result.columns]);
  const measures = useMemo(
    () =>
      result.columns.filter(
        (c) => c.isMeasure || c.dataType === 'number' || c.dataType === 'currency',
      ),
    [result.columns],
  );

  // KPI Cards
  if (vizType === 'KPI') {
    if (measures.length === 0) {
      return <div className="rbs-status-box">{msg.canvas.chartNeedsMeasure}</div>;
    }
    return (
      <div className="rbs-kpi-grid">
        {measures.map((m) => {
          const totalVal =
            result.totals && result.totals[m.key] !== undefined
              ? result.totals[m.key]
              : result.rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0);
          return (
            <div key={m.key} className="rbs-kpi-card">
              <div className="rbs-kpi-label">
                {definition.visualizationOptions.kpiTitle || m.label}
              </div>
              <div className="rbs-kpi-value">
                {`${definition.visualizationOptions.kpiPrefix ?? ''}${formatCellValue(totalVal, m.format, locale)}${definition.visualizationOptions.kpiSuffix ?? ''}`}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (measures.length === 0) {
    return <div className="rbs-status-box">{msg.canvas.chartNeedsMeasure}</div>;
  }
  if (dims.length === 0 && vizType !== 'HEATMAP') {
    return <div className="rbs-status-box">{msg.canvas.chartNeedsDimension}</div>;
  }

  const labelCol = dims[0];
  const chartRows = result.rows.slice(0, 24);
  const primaryMeasure = measures[0];

  // Clean Rounded Horizontal Progress Bars matching Mockup
  if (vizType === 'BAR') {
    const maxVal = Math.max(
      1,
      ...chartRows.map((r) => Math.abs(Number(r[primaryMeasure.key]) || 0)),
    );
    return (
      <div className="rbs-chart-card">
        <h3 className="rbs-chart-card-title">{primaryMeasure.label}</h3>
        <div className="rbs-bar-list">
          {chartRows.map((r, i) => {
            const val = Number(r[primaryMeasure.key]) || 0;
            const pct = Math.max(4, Math.min(100, (Math.abs(val) / maxVal) * 100));
            const lbl = String(r[labelCol.key] ?? '—');
            return (
              <div key={i} className="rbs-bar-row">
                <span className="rbs-bar-label" title={lbl}>
                  {lbl}
                </span>
                <div className="rbs-bar-track">
                  <div
                    className="rbs-bar-fill"
                    style={{
                      width: `${pct.toFixed(1)}%`,
                      background: `linear-gradient(90deg, ${colors[0]} 0%, ${colors[1] ?? colors[0]} 100%)`,
                    }}
                  />
                </div>
                <span className="rbs-bar-val">
                  {formatCellValue(val, primaryMeasure.format, locale)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Heatmap View
  if (vizType === 'HEATMAP') {
    const heatMeasures = measures.slice(0, 8);
    const maxVal = Math.max(
      1,
      ...chartRows.flatMap((r) => heatMeasures.map((m) => Math.abs(Number(r[m.key]) || 0))),
    );
    return (
      <div className="rbs-chart-card">
        <div className="rbs-table-wrap" style={{ border: 'none' }}>
          <table className="rbs-table">
            <thead>
              <tr>
                <th>{labelCol?.label ?? '#'}</th>
                {heatMeasures.map((m) => (
                  <th key={m.key} className="rbs-num">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  <td>{labelCol ? String(row[labelCol.key] ?? '—') : rIdx + 1}</td>
                  {heatMeasures.map((m) => {
                    const num = Number(row[m.key]) || 0;
                    const alpha = Math.min(0.85, Math.max(0.08, Math.abs(num) / maxVal));
                    return (
                      <td
                        key={m.key}
                        className="rbs-num"
                        style={{
                          backgroundColor: `rgba(37, 99, 235, ${alpha.toFixed(2)})`,
                          color: alpha > 0.5 ? '#ffffff' : '#0f172a',
                        }}
                      >
                        {formatCellValue(num, m.format, locale)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Pie & Donut Chart View
  if (vizType === 'PIE' || vizType === 'DONUT') {
    const slices = chartRows
      .map((r, i) => ({
        label: String(r[labelCol.key] ?? '—'),
        value: Math.max(0, Number(r[primaryMeasure.key]) || 0),
        color: colors[i % colors.length],
      }))
      .filter((s) => s.value > 0);
    const sum = slices.reduce((acc, s) => acc + s.value, 0) || 1;
    let angle = -Math.PI / 2;

    return (
      <div className="rbs-chart-card">
        {hoveredText && (
          <div className="rbs-pill rbs-pill-brand" style={{ marginBottom: '8px' }}>
            {hoveredText}
          </div>
        )}
        <svg
          viewBox="0 0 420 260"
          width="100%"
          height="290"
          role="img"
          aria-label={msg.canvas.views[vizType]}
        >
          {slices.map((slice, i) => {
            const pct = slice.value / sum;
            const end = angle + pct * Math.PI * 2;
            const r = 100;
            const cx = 140;
            const cy = 130;
            const x1 = cx + r * Math.cos(angle);
            const y1 = cy + r * Math.sin(angle);
            const x2 = cx + r * Math.cos(end);
            const y2 = cy + r * Math.sin(end);
            const large = pct > 0.5 ? 1 : 0;
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
            angle = end;
            return (
              <path
                key={i}
                d={d}
                fill={slice.color}
                stroke="#ffffff"
                strokeWidth="2"
                onMouseEnter={() =>
                  setHoveredText(
                    `${slice.label}: ${formatCellValue(slice.value, primaryMeasure.format, locale)} (${(pct * 100).toFixed(1)}%)`,
                  )
                }
                onMouseLeave={() => setHoveredText(null)}
              />
            );
          })}
          {vizType === 'DONUT' && <circle cx={140} cy={130} r={52} fill="#ffffff" />}
          <g transform="translate(265, 36)">
            {slices.slice(0, 10).map((s, i) => (
              <g key={i} transform={`translate(0, ${i * 20})`}>
                <rect width="12" height="12" rx="3" fill={s.color} />
                <text x="18" y="10" fontSize="11" fill="#334155">
                  {s.label.slice(0, 18)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    );
  }

  // Cartesian SVG Charts (COLUMN, LINE, AREA, STACKED_BAR, COMBO)
  const activeMeasures =
    vizType === 'STACKED_BAR' || vizType === 'COMBO' ? measures.slice(0, 4) : measures.slice(0, 3);
  const w = 720;
  const h = 300;
  const padL = 68;
  const padB = 48;
  const padT = 20;
  const padR = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxVal = Math.max(
    1,
    ...(vizType === 'STACKED_BAR'
      ? chartRows.map((r) => activeMeasures.reduce((s, m) => s + (Number(r[m.key]) || 0), 0))
      : chartRows.flatMap((r) => activeMeasures.map((m) => Number(r[m.key]) || 0))),
  );
  const slotW = plotW / Math.max(1, chartRows.length);

  return (
    <div className="rbs-chart-card">
      {hoveredText && (
        <div className="rbs-pill rbs-pill-brand" style={{ marginBottom: '8px' }}>
          {hoveredText}
        </div>
      )}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="310"
        role="img"
        aria-label={msg.canvas.views[vizType]}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill="#64748b">
                {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(maxVal * t)}
              </text>
            </g>
          );
        })}

        {(vizType === 'COLUMN' || vizType === 'STACKED_BAR' || vizType === 'COMBO') &&
          chartRows.map((row, idx) => {
            const xBase = padL + idx * slotW + 8;
            const innerW = Math.max(10, slotW - 16);
            const lbl = String(row[labelCol.key] ?? '—');

            if (vizType === 'STACKED_BAR') {
              let runningY = padT + plotH;
              return (
                <g key={idx}>
                  {activeMeasures.map((m, mIdx) => {
                    const val = Math.max(0, Number(row[m.key]) || 0);
                    const bh = (val / maxVal) * plotH;
                    runningY -= bh;
                    return (
                      <rect
                        key={m.key}
                        x={xBase}
                        y={runningY}
                        width={innerW}
                        height={Math.max(1, bh)}
                        rx={3}
                        fill={colors[mIdx % colors.length]}
                        onMouseEnter={() =>
                          setHoveredText(
                            `${lbl} · ${m.label}: ${formatCellValue(val, m.format, locale)}`,
                          )
                        }
                        onMouseLeave={() => setHoveredText(null)}
                      />
                    );
                  })}
                  <text
                    x={xBase + innerW / 2}
                    y={h - 14}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill="#64748b"
                  >
                    {lbl.slice(0, 11)}
                  </text>
                </g>
              );
            }

            const colMeasures = vizType === 'COMBO' ? activeMeasures.slice(0, 1) : activeMeasures;
            const bw = Math.max(8, innerW / colMeasures.length - 3);
            return (
              <g key={idx}>
                {colMeasures.map((m, mIdx) => {
                  const val = Math.max(0, Number(row[m.key]) || 0);
                  const bh = (val / maxVal) * plotH;
                  const bx = xBase + mIdx * (bw + 3);
                  const by = padT + plotH - bh;
                  return (
                    <g key={m.key}>
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={Math.max(2, bh)}
                        rx={5}
                        fill={colors[mIdx % colors.length]}
                        onMouseEnter={() =>
                          setHoveredText(
                            `${lbl} · ${m.label}: ${formatCellValue(val, m.format, locale)}`,
                          )
                        }
                        onMouseLeave={() => setHoveredText(null)}
                      />
                      {showDataLabels && (
                        <text
                          x={bx + bw / 2}
                          y={Math.max(12, by - 4)}
                          textAnchor="middle"
                          fontSize="9.5"
                          fill="#1e293b"
                        >
                          {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
                            notation: 'compact',
                          }).format(val)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text
                  x={xBase + innerW / 2}
                  y={h - 14}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill="#64748b"
                >
                  {lbl.slice(0, 11)}
                </text>
              </g>
            );
          })}

        {(vizType === 'LINE' ||
          vizType === 'AREA' ||
          (vizType === 'COMBO' && activeMeasures.length > 1)) &&
          (vizType === 'COMBO' ? activeMeasures.slice(1) : activeMeasures).map((m, mIdx) => {
            const colorIdx = vizType === 'COMBO' ? mIdx + 1 : mIdx;
            const strokeColor = colors[colorIdx % colors.length];
            const pts = chartRows.map((row, idx) => {
              const val = Number(row[m.key]) || 0;
              const x = padL + idx * slotW + slotW / 2;
              const y = padT + plotH - (val / maxVal) * plotH;
              return { x, y, val, lbl: String(row[labelCol.key] ?? '—') };
            });
            const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
            const areaPath =
              pts.length > 0
                ? `M ${pts[0].x} ${padT + plotH} L ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${pts[pts.length - 1].x} ${padT + plotH} Z`
                : '';

            return (
              <g key={m.key}>
                {vizType === 'AREA' && areaPath && (
                  <path d={areaPath} fill={strokeColor} fillOpacity="0.16" />
                )}
                {pts.length > 1 && (
                  <polyline fill="none" stroke={strokeColor} strokeWidth="2.5" points={polyline} />
                )}
                {pts.map((p, idx) => (
                  <g key={idx}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="4"
                      fill={strokeColor}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                      onMouseEnter={() =>
                        setHoveredText(
                          `${p.lbl} · ${m.label}: ${formatCellValue(p.val, m.format, locale)}`,
                        )
                      }
                      onMouseLeave={() => setHoveredText(null)}
                    />
                    {mIdx === 0 && (vizType === 'LINE' || vizType === 'AREA') && (
                      <text x={p.x} y={h - 14} textAnchor="middle" fontSize="10.5" fill="#64748b">
                        {p.lbl.slice(0, 11)}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}
      </svg>

      {showLegend && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            marginTop: '10px',
            fontSize: '12.5px',
          }}
        >
          {activeMeasures.map((m, idx) => (
            <span key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '3px',
                  background: colors[idx % colors.length],
                }}
              />
              <span>{m.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
