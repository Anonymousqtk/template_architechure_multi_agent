import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { DashIcon } from '../../components/layout/DashboardShell';
import { errorText, request, type Profile } from '../../services/api';
import { ReportCharts } from '../Reporting/builder/ReportCharts';
import { reportBuilderMessages } from '../Reporting/reportBuilderMessages';
import type {
  ReportDefinition,
  ReportExecutionResult,
} from '../Reporting/builder/reportBuilderTypes';
import { executiveMessages } from './executiveMessages';
import type {
  AnalyticsRange,
  ExecutiveAnalytics as Analytics,
  ExecutiveAudit,
} from './executiveTypes';
import '../../assets/styles/executive-analytics.css';
import '../../assets/styles/report-builder.css';

function initialRange(): AnalyticsRange {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today, grain: 'month' };
}

function queryString(range: AnalyticsRange) {
  return new URLSearchParams(
    Object.entries(range).filter(([, value]) => Boolean(value)),
  ).toString();
}

export function ExecutiveAnalytics({ profile }: { profile: Profile }) {
  const { locale } = useTranslation();
  const msg = executiveMessages[locale];
  const [draft, setDraft] = useState(initialRange);
  const [range, setRange] = useState(draft);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    data: Analytics | null;
    loading: boolean;
    error: unknown;
    key: string;
  }>({ data: null, loading: true, error: false, key: '' });
  const base = `/api/organizations/${encodeURIComponent(profile.organization.id)}/reports/executive`;
  const key = `${base}:${profile.user.id}:${profile.organization.role}:${queryString(range)}:${revision}`;
  const eligible = ['ADMIN', 'HR', 'MANAGER'].includes(profile.organization.role);
  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    setState({ data: null, loading: true, error: false, key });
    request<Analytics>(`${base}?${queryString(range)}`)
      .then((data) => {
        if (!data?.capabilities || !data.workforce || !Array.isArray(data.structure))
          throw Error('INVALID_ANALYTICS');
        if (alive) setState({ data, loading: false, error: false, key });
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, loading: false, error, key });
      });
    return () => {
      alive = false;
    };
  }, [base, key, range, eligible]);
  if (!eligible) return null;
  // Hide old tenant/role/filter data immediately, before effects run.
  const data = state.key === key ? state.data : null;
  const busy = state.key !== key || state.loading;
  const number = (value: number | string | null | undefined, unit = '') =>
    value === null || value === undefined
      ? msg.unavailable
      : `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value))}${unit ? ` ${unit}` : ''}`;
  const time = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Bangkok',
        }).format(new Date(value))
      : msg.unavailable;
  const metric = (
    label: string,
    value: number | string | null,
    unit: string,
    definition?: string,
  ) => (
    <article
      className="exec-metric"
      data-state={value === null ? 'missing' : 'available'}
      data-tone={unit === msg.money ? 'indigo' : unit === msg.percent ? 'teal' : 'violet'}
      key={label}
    >
      <span className="exec-metric-icon" aria-hidden="true">
        <DashIcon name={unit === msg.money ? 'money' : unit === msg.percent ? 'list' : 'users'} />
      </span>
      <h4>{label}</h4>
      <strong>{number(value, unit)}</strong>
      {definition && (
        <details>
          <summary title={msg.formula}>{msg.metricDetails}</summary>
          <p>{definition}</p>
        </details>
      )}
    </article>
  );
  const chart = (
    rows: Array<{ label: string | null; value: number | string }>,
    label: string,
    type: 'BAR' | 'LINE' = 'BAR',
    currency = false,
  ) => {
    if (!rows.length) return <p>{msg.noData}</p>;
    if (type === 'LINE' && rows.length === 1)
      return (
        <div className="exec-single-period">
          <span>{rows[0].label}</span>
          <strong>{number(rows[0].value, currency ? msg.money : '')}</strong>
          <p>{msg.singlePeriod}</p>
        </div>
      );
    const format = currency ? 'currency' : 'number';
    const definition = {
      primaryEntity: 'employees',
      relatedEntities: [],
      columns: [],
      rows: [],
      pivotColumns: [],
      values: [],
      groupBy: [],
      filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
      sortBy: [],
      calculatedFields: [],
      conditionalFormatting: [],
      visualizationOptions: { showDataLabels: true, palette: 'violet' },
      visualizationType: type,
      showSubtotals: false,
      showGrandTotal: false,
      pageSize: 50,
    } satisfies ReportDefinition;
    const result = {
      mode: 'GROUPED',
      columns: [
        {
          key: 'label',
          fieldId: 'label',
          label: msg.department,
          dataType: 'string',
          format: 'text',
          isMeasure: false,
        },
        {
          key: 'value',
          fieldId: 'value',
          label,
          dataType: currency ? 'currency' : 'number',
          format,
          isMeasure: true,
        },
      ],
      rows: rows.map((r) => ({ label: r.label ?? msg.unassigned, value: Number(r.value) })),
      totals: {},
      pagination: { page: 1, pageSize: rows.length, totalRows: rows.length, totalPages: 1 },
      meta: { executionMs: 0, cached: false, rowLimitReached: false },
    } satisfies ReportExecutionResult;
    return (
      <>
        <ReportCharts
          locale={locale}
          msg={reportBuilderMessages[locale]}
          vizType={type}
          definition={definition}
          result={result}
        />
        <details>
          <summary>
            {msg.records} · {rows.length}
          </summary>
          <div className="exec-table-scroll">
            <table>
              <caption>{label}</caption>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.label ?? msg.unassigned}</th>
                    <td>{number(row.value, currency ? msg.money : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </>
    );
  };
  const finance =
    data?.capabilities.financial && ['ADMIN', 'HR'].includes(profile.organization.role)
      ? data.cost
      : null;
  return (
    <section className="exec-analytics" aria-labelledby="exec-title">
      <header className="exec-heading">
        <div>
          <h2 id="exec-title">{msg.title}</h2>
        </div>
        <div className="exec-heading-actions">
          <a className="exec-action-secondary" href="/admin/units">
            <DashIcon name="building" />
            {msg.selectUnit}
          </a>
          <a className="exec-action-primary" href="/admin/reports">
            <DashIcon name="list" />
            {msg.reports}
          </a>
        </div>
      </header>
      <details className="exec-filter-panel">
        <summary>
          <DashIcon name="search" />
          <span>{msg.filtersTitle}</span>
          <span className="exec-filter-period">
            {range.startDate.split('-').reverse().join('/')} –{' '}
            {range.endDate.split('-').reverse().join('/')}
          </span>
        </summary>
        <form
          className="exec-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setRange({ ...draft });
            setRevision((r) => r + 1);
          }}
        >
          <label>
            {msg.organization}
            <input value={profile.organization.name} readOnly />
          </label>
          {(['branchId', 'departmentId'] as const).map((field) => (
            <label key={field}>
              {field === 'branchId' ? msg.branch : msg.department}
              <select
                value={draft[field] ?? ''}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value || undefined })}
              >
                <option value="">{msg.all}</option>
                {data?.departments.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            {msg.grain}
            <select
              value={draft.grain}
              onChange={(e) =>
                setDraft({ ...draft, grain: e.target.value as AnalyticsRange['grain'] })
              }
            >
              {(['month', 'quarter', 'year'] as const).map((g) => (
                <option value={g} key={g}>
                  {msg[g]}
                </option>
              ))}
            </select>
          </label>
          {(['startDate', 'endDate', 'compareStartDate', 'compareEndDate'] as const).map(
            (field, index) => (
              <label key={field}>
                {[msg.start, msg.end, msg.compareStart, msg.compareEnd][index]}
                <input
                  type="date"
                  required={index < 2}
                  value={draft[field] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value || undefined })}
                />
              </label>
            ),
          )}
          <button type="submit" disabled={busy}>
            {msg.apply}
          </button>
        </form>
        <p className="exec-source">{msg.rangeNote}</p>
      </details>
      {busy && <p role="status">{msg.loading}</p>}
      {state.key === key && Boolean(state.error) && (
        <div role="alert">
          <p>{msg.error}</p>
          <p className="exec-description">{errorText(state.error)}</p>
          <button onClick={() => setRevision((r) => r + 1)}>{msg.retry}</button>
        </div>
      )}
      {data && (
        <>
          <div className="exec-overview-meta">
            <span>
              {msg.snapshot}: {data.snapshotDate}
            </span>
            <span>
              {msg.fetched}: {time(data.generatedAt)}
            </span>
          </div>
          <div className="exec-metrics exec-overview-kpis">
            {metric(msg.headcount, data.workforce.headcount, msg.people, msg.headcountDef)}
            {metric(msg.hires, data.workforce.hires, msg.people, msg.hiresDef)}
            {metric(
              msg.attendanceRate,
              data.attendance.attendanceRate,
              msg.percent,
              msg.attendanceDef,
            )}
            {finance
              ? metric(msg.gross, finance.current.gross, msg.money)
              : metric(msg.absence, data.attendance.absenteeismRate, msg.percent, msg.absenceDef)}
          </div>
          <div className="exec-panels exec-primary-charts">
            <section>
              <h3>{msg.structure}</h3>
              {chart(
                data.structure.filter((r) => r.kind === 'department'),
                msg.count,
              )}
            </section>
            <section>
              <h3>{finance ? msg.trend : msg.positions}</h3>
              {finance
                ? chart(finance.current.trends, msg.gross, 'LINE', true)
                : chart(
                    data.structure.filter((r) => r.kind === 'position'),
                    msg.count,
                  )}
            </section>
          </div>
          <details className="exec-disclosure exec-operational-details">
            <summary>
              {msg.attendance} ? {finance ? msg.costDepartments : msg.historyTitle}
            </summary>
            <div className="exec-disclosure-body">
              <div className="exec-panels exec-secondary-panels">
                <section className="exec-attendance">
                  <h3>{msg.attendance}</h3>
                  <div className="exec-metrics exec-inline-metrics">
                    {metric(msg.leave, data.attendance.leaveRate, msg.percent, msg.leaveDef)}
                    {metric(
                      msg.overtime,
                      data.attendance.overtimeRate,
                      msg.percent,
                      msg.overtimeDef,
                    )}
                    {finance &&
                      metric(
                        msg.absence,
                        data.attendance.absenteeismRate,
                        msg.percent,
                        msg.absenceDef,
                      )}
                  </div>
                  <details className="exec-methodology">
                    <summary>{msg.formula}</summary>
                    <p>{msg.attendanceNote}</p>
                  </details>
                </section>
                <section>
                  <h3>{finance ? msg.costDepartments : msg.historyTitle}</h3>
                  {finance ? (
                    chart(
                      finance.current.departments.map((d) => ({ label: d.label, value: d.gross })),
                      msg.gross,
                      'BAR',
                      true,
                    )
                  ) : (
                    <p className="exec-empty">{msg.historyNote}</p>
                  )}
                </section>
              </div>
            </div>
          </details>
          {finance ? (
            <details className="exec-disclosure exec-finance-details">
              <summary>
                {msg.financeDetails}
                <span>
                  {finance.anomalies.length
                    ? `${msg.alerts}: ${finance.anomalies.reduce((total, item) => total + item.count, 0)}`
                    : msg.money}
                </span>
              </summary>
              <div className="exec-disclosure-body">
                <div className="exec-metrics exec-finance-summary">
                  {metric(msg.recognized, finance.journal.recognized, msg.money)}
                  {metric(msg.paid, finance.current.payments.amount, msg.money)}
                  {metric(
                    msg.averageSalary,
                    finance.current.averageSalary,
                    msg.money,
                    msg.averageSalaryDef,
                  )}
                  {metric(
                    msg.costPerEmployee,
                    finance.costPerEmployee,
                    msg.money,
                    msg.costPerEmployeeDef,
                  )}
                  {metric(msg.liability, finance.journal.liabilityMovement, msg.money)}
                  {metric(msg.net, finance.current.net, msg.money)}
                  {metric(msg.change, finance.grossChangePercent, msg.percent)}
                </div>
                <h3>{msg.componentsTitle}</h3>
                <div className="exec-metrics exec-component-grid">
                  {metric(msg.base, finance.current.base, msg.money)}
                  {metric(msg.allowances, finance.current.allowances, msg.money)}
                  {metric(msg.bonuses, finance.current.bonuses, msg.money)}
                  {metric(msg.overtimePay, finance.current.overtime, msg.money)}
                  {metric(msg.insurance, finance.current.insurance.employer, msg.money)}
                  {metric(msg.employeeInsurance, finance.current.insurance.employee, msg.money)}
                </div>
                <p className="exec-comparison">
                  {msg.previous}: {data.range.compareStartDate} ? {data.range.compareEndDate} ?{' '}
                  {msg.gross}: {number(finance.previous.gross, msg.money)}
                </p>
                <p className="exec-description">{msg.costNote}</p>
                <p className="exec-description">{msg.accountingNote}</p>
                {Boolean(finance.current.insurance.excludedCurrencyRecords) && (
                  <p className="exec-note">{msg.currencyNote}</p>
                )}
                <p className="exec-source">
                  {msg.sourceUpdated}: {time(finance.current.updatedAt)} ? {msg.records}:{' '}
                  {finance.current.records}
                </p>
                <p className="exec-source">
                  {msg.insurance}: {time(finance.current.insurance.updatedAt)} ? {msg.paid}:{' '}
                  {time(finance.current.payments.updatedAt)}
                </p>
                <details>
                  <summary>{msg.periodStatus}</summary>
                  <ul>
                    {finance.current.periods.map((p) => (
                      <li key={p.id}>
                        {p.name} ? {p.startDate} ? {p.endDate} ? {p.status}
                      </li>
                    ))}
                  </ul>
                  {!finance.current.periods.length && <p>{msg.noData}</p>}
                </details>
                <section className="exec-alerts">
                  <h3>{msg.alerts}</h3>
                  <p>{msg.alertNote}</p>
                  {finance.anomalies.length ? (
                    <ul>
                      {finance.anomalies.map((a) => (
                        <li key={a.code + ':' + a.severity + ':' + a.status}>
                          {a.code} ? {a.severity} ? {a.status} ? {a.count}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{msg.noData}</p>
                  )}
                </section>
              </div>
            </details>
          ) : (
            <p className="exec-source">{msg.financeRestricted}</p>
          )}
          <details className="exec-disclosure exec-data-details">
            <summary>{msg.dataDetails}</summary>
            <div className="exec-disclosure-body">
              <p>{msg.snapshotNote}</p>
              <p className="exec-source">
                {msg.sourceUpdated}: {time(data.workforce.updatedAt)}
              </p>
              <h3>{msg.positions}</h3>
              {chart(
                data.structure.filter((r) => r.kind === 'position'),
                msg.count,
              )}
              <h3>{msg.historyTitle}</h3>
              <div className="exec-metrics">
                {metric(msg.departures, data.lifecycle.departures, msg.people, msg.departuresDef)}
                {metric(msg.growth, data.lifecycle.growth, msg.percent, msg.growthDef)}
                {metric(msg.turnover, data.lifecycle.turnover, msg.percent, msg.turnoverDef)}
                {metric(msg.retention, data.lifecycle.retention, msg.percent, msg.retentionDef)}
              </div>
              {!data.capabilities.historicalEmployment && <p>{msg.historyNote}</p>}
              {!data.capabilities.budget && <p>{msg.budgetNote}</p>}
              {!data.capabilities.recruitment && <p>{msg.recruitmentNote}</p>}
            </div>
          </details>
          {profile.organization.role === 'ADMIN' && data.capabilities.audit && (
            <AuditPanel key={base + ':' + profile.user.id} base={base} range={range} />
          )}
        </>
      )}
    </section>
  );
}

function AuditPanel({ base, range }: { base: string; range: AnalyticsRange }) {
  const { locale } = useTranslation();
  const msg = executiveMessages[locale];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ actorId: '', action: '', target: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: ExecutiveAudit | null; error: boolean }>({
    key: '',
    data: null,
    error: false,
  });
  const query = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
    page: String(page),
    limit: '20',
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const serializedQuery = query.toString();
  const key = `${serializedQuery}:${revision}`;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ key, data: null, error: false });
    request<ExecutiveAudit>(`${base}/audit?${serializedQuery}`)
      .then((data) => {
        if (!Array.isArray(data?.items)) throw Error('INVALID_AUDIT');
        if (alive) setState({ key, data, error: false });
      })
      .catch(() => {
        if (alive) setState({ key, data: null, error: true });
      });
    return () => {
      alive = false;
    };
  }, [base, key, open, serializedQuery]);
  const data = state.key === key ? state.data : null;
  const error = state.key === key && state.error;
  return (
    <section className="exec-section exec-audit">
      <h3>{msg.audit}</h3>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? msg.closeAudit : msg.openAudit}
      </button>
      {open && (
        <>
          <p>{msg.auditNote}</p>
          <form
            className="exec-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ ...draft });
              setPage(1);
              setRevision((r) => r + 1);
            }}
          >
            {(['actorId', 'action', 'target'] as const).map((field) => (
              <label key={field}>
                {field === 'actorId' ? msg.actor : msg[field]}
                <input
                  value={draft[field]}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                />
              </label>
            ))}
            <button type="submit">{msg.apply}</button>
          </form>
          {error ? (
            <p role="alert">{msg.auditError}</p>
          ) : !data ? (
            <p role="status">{msg.loading}</p>
          ) : (
            <>
              <div className="exec-table-scroll">
                <table>
                  <caption>
                    {msg.audit} · {data.total}
                  </caption>
                  <thead>
                    <tr>
                      {[msg.at, msg.actor, msg.action, msg.target, msg.source].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={`${item.source}:${item.id}`}>
                        <td>
                          {new Date(item.at).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
                            timeZone: 'Asia/Bangkok',
                          })}
                        </td>
                        <td>{item.actor ?? msg.unavailable}</td>
                        <td>{item.action}</td>
                        <td>{item.target ?? msg.unavailable}</td>
                        <td>{item.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.items.length && <p>{msg.noData}</p>}
              <div className="exec-pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  {msg.back}
                </button>
                <span>
                  {msg.page} {page}
                </span>
                <button
                  disabled={page * data.limit >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  {msg.next}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
