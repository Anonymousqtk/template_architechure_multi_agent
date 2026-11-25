import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ApiError, errorText, request, type Department, type Profile } from '../../services/api';
import { useTranslation } from '../../i18n';
import { reportingMessages } from './reportingMessages';
import { SlideDialog } from '../../components/common/SlideDialog';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { reportBuilderMessages } from './reportBuilderMessages';
import { ReportBuilderStudio } from './builder/ReportBuilderStudio';
import '../../assets/styles/reporting.css';
import '../../assets/styles/report-builder.css';

export interface ReportItem {
  id?: string;
  code: string;
  category:
    | 'EMPLOYEE'
    | 'ORGANIZATION'
    | 'ATTENDANCE'
    | 'LEAVE'
    | 'PAYROLL'
    | 'ACCOUNTING'
    | 'COMPLIANCE'
    | 'OTHER';
  name: string;
  description: string;
  minRole: string;
  displayOrder: number;
  supportedFilters: string[];
}

export interface ExportAuditLog {
  id: string;
  reportCode: string;
  format: string;
  rowCount: number;
  filters: Record<string, unknown>;
  exportedBy: string;
  userName: string;
  userEmail: string;
  exportedAt: string;
}

export interface SavedTemplate {
  id: string;
  reportCode: string;
  templateName: string;
  filters: Record<string, string>;
  createdAt: string;
}

type ReportAmount = string | number;

interface ReportTableRow {
  id?: string;
  code?: string;
  name?: string;
  employeeId?: string;
  employeeCode?: string;
  fullName?: string;
  departmentCode?: string;
  departmentId?: string;
  departmentName?: string;
  parentName?: string;
  managerName?: string;
  positionTitle?: string;
  positions?: Array<{ title: string }>;
  employmentStatus?: string;
  contractType?: string;
  contractNumber?: string;
  hireDate?: string;
  contractStartDate?: string;
  phone?: string;
  scheduleId?: string;
  workDate?: string;
  shiftName?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  status?: string;
  leaveTypeId?: string;
  leaveTypeName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  settlementStatus?: string;
  entryNumber?: string;
  entryDate?: string;
  description?: string;
  lines?: Array<{
    accountCode: string;
    accountName: string;
    debitAmount: ReportAmount;
    creditAmount: ReportAmount;
  }>;
  totalDebit?: ReportAmount;
  totalCredit?: ReportAmount;
  reversalEntryNumber?: string;
  postedByName?: string;
  postedAt?: string;
  taxCode?: string;
  idNumber?: string;
  settlementType?: string;
  proxyAuthorized?: boolean;
  socialInsuranceCode?: string;
  fluctuationType?: string;
  effectiveDate?: string;
  gender?: string;
  birthDate?: string;
  educationLevel?: string;
  actualWorkingDays?: number;
  standardDays?: number;
  employeeCount?: number;
  positionCount?: number;
  tenureMonths?: number;
  lateMinutes?: number;
  earlyMinutes?: number;
  allowanceDays?: number;
  chargedDays?: number;
  remainingDays?: number;
  utilizationRate?: number;
  headcount?: number;
  dependentCount?: number;
  monthsWorked?: number;
  isActive?: boolean;
  isAnomalous?: boolean;
  varianceAmount?: ReportAmount;
  variancePct?: ReportAmount;
  remainingBalance?: ReportAmount;
  accountCode?: string;
  accountName?: string;
  vasAccountFull?: string;
  vasAccount?: string;
  grossSalary?: ReportAmount;
  grossPay?: ReportAmount;
  employerInsurance?: ReportAmount;
  employerStatutory?: ReportAmount;
  employerUnion?: ReportAmount;
  tradeUnion?: ReportAmount;
  totalCostToCompany?: ReportAmount;
  netPayable?: ReportAmount;
  totalPaid?: ReportAmount;
  grossIncome?: ReportAmount;
  taxableIncome?: ReportAmount;
  variance?: ReportAmount;
  personalDeduction?: ReportAmount;
  dependentDeductions?: ReportAmount;
  insuranceDeductions?: ReportAmount;
  assessableIncome?: ReportAmount;
  calculatedPitTax?: ReportAmount;
  slipPitTax?: ReportAmount;
  annualGrossIncome?: ReportAmount;
  annualPersonalDeduction?: ReportAmount;
  annualDependentDeduction?: ReportAmount;
  annualInsuranceDeductions?: ReportAmount;
  annualAssessableIncome?: ReportAmount;
  annualTaxLiability?: ReportAmount;
  taxAlreadyWithheld?: ReportAmount;
  taxBalance?: ReportAmount;
  salarySi?: ReportAmount;
  salaryUi?: ReportAmount;
  totalEmployeeShare?: ReportAmount;
  totalEmployerShare?: ReportAmount;
  tradeUnionFee?: ReportAmount;
  totalContribution?: ReportAmount;
  newSalarySi?: ReportAmount;
  baseSalary?: ReportAmount;
  totalAllowances?: ReportAmount;
  totalBonuses?: ReportAmount;
  totalDeductions?: ReportAmount;
  netPay?: ReportAmount;
  nonTaxableAllowances?: ReportAmount;
  taxableAllowances?: ReportAmount;
  statutoryDeductions?: ReportAmount;
  pitDeduction?: ReportAmount;
  otherDeductions?: ReportAmount;
  compareNetPay?: ReportAmount;
  currentNetPay?: ReportAmount;
  totalRemainingBalance?: ReportAmount;
  note?: string;
  notes?: string;
}

type ReportMetricKey =
  | 'activeEmployees'
  | 'anomalousCount'
  | 'approvedRequests'
  | 'attendanceRate'
  | 'authorizedCount'
  | 'averageTenureMonths'
  | 'avgPayDeltaPerEmployee'
  | 'balanceDelta'
  | 'decreaseCount'
  | 'departmentCount'
  | 'departmentsWithManager'
  | 'earlyLeaveCount'
  | 'employeeCount'
  | 'femaleEmployees'
  | 'fixedTermContractCount'
  | 'headcountDelta'
  | 'increaseCount'
  | 'indefiniteContractCount'
  | 'lateCount'
  | 'netPayDelta'
  | 'netPayVariancePct'
  | 'newHiresInPeriod'
  | 'onTimeCount'
  | 'overallUtilizationRate'
  | 'postedEntriesCount'
  | 'probationContractCount'
  | 'salaryAdjustmentCount'
  | 'settledSlipsCount'
  | 'settlementRate'
  | 'slipCount'
  | 'taxableEmployeeCount'
  | 'terminatedEmployees'
  | 'terminationsInPeriod'
  | 'totalAdditionalTaxPayable'
  | 'totalAllowanceDays'
  | 'totalAllowances'
  | 'totalAnnualIncome'
  | 'totalAssignedEmployees'
  | 'totalBonuses'
  | 'totalChargedDays'
  | 'totalCostToCompany'
  | 'totalCredit'
  | 'totalDebit'
  | 'totalDeductions'
  | 'totalDepartments'
  | 'totalDisbursed'
  | 'totalEarlyMinutes'
  | 'totalEmployees'
  | 'totalEmployeeShare'
  | 'totalEmployerShare'
  | 'totalEmployerSocialInsurance'
  | 'totalEntriesCount'
  | 'totalFluctuations'
  | 'totalGrossPay'
  | 'totalLateMinutes'
  | 'totalNetPay'
  | 'totalNetPayable'
  | 'totalNonTaxableAllowances'
  | 'totalPitDeductions'
  | 'totalPitTax'
  | 'totalPositions'
  | 'totalRefundAmount'
  | 'totalRemainingBalance'
  | 'totalRemainingDays'
  | 'totalRemittance'
  | 'totalSchedules'
  | 'totalStatutoryDeductions'
  | 'totalTaxableAllowances'
  | 'totalTaxableIncome'
  | 'totalTaxLiability'
  | 'totalTaxWithheld'
  | 'totalTradeUnion'
  | 'totalTradeUnionFee'
  | 'totalVariance'
  | 'unsettledSlipsCount'
  | 'varianceCount';

interface ReportData {
  metrics?: Partial<Record<ReportMetricKey, ReportAmount>> & { isBalanced?: boolean };
  pagination?: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  items?: ReportTableRow[];
  departments?: ReportTableRow[];
  balances?: ReportTableRow[];
}

function formatVND(val: number | string | undefined | null) {
  if (val === undefined || val === null || val === '') return '0 ₫';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? '0 ₫' : num.toLocaleString('vi-VN') + ' ₫';
}

interface Props {
  profile: Profile;
  onNavigate?: (to: string) => void;
  initialReportCode?: string;
}

export function ReportingCenter({ profile, initialReportCode }: Props) {
  const { locale } = useTranslation();
  const tr = reportingMessages[locale];
  const rbMsg = reportBuilderMessages[locale];
  const orgId = profile.organization.id;
  const isPrivileged = ['ADMIN', 'HR'].includes(profile.organization.role);

  // Navigation & Catalog State
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [activeReport, setActiveReport] = useState<ReportItem | null>(null);

  // Common filters
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterContractType, setFilterContractType] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Date range filters
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const defaultEnd = now.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(defaultStart);
  const [endDate, setEndDate] = useState<string>(defaultEnd);

  // Payroll & Accounting filters
  const [payrollPeriods, setPayrollPeriods] = useState<
    Array<{ id: string; code: string; name: string; status: string }>
  >([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [comparePeriodId, setComparePeriodId] = useState<string>('');
  const [filterSettlementStatus, setFilterSettlementStatus] = useState<string>('');

  // Compliance filters
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedHalf, setSelectedHalf] = useState<string>('1');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  // Data & Execution State
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [auditLogs, setAuditLogs] = useState<ExportAuditLog[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [templateNameInput, setTemplateNameInput] = useState<string>('');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Load Catalog & Departments
  useEffect(() => {
    async function loadInitial() {
      try {
        setLoading(true);
        const [catRes, deptRes] = await Promise.all([
          request<{ reports: ReportItem[] }>(`/api/organizations/${orgId}/reports/catalog`),
          request<{ departments?: Department[]; items?: Department[] }>(
            `/api/organizations/${orgId}/departments?limit=100`,
          ).catch(() => ({ departments: [], items: [] })),
        ]);

        setReports(catRes.reports);
        setDepartments(deptRes.departments || deptRes.items || []);

        if (initialReportCode) {
          const match = catRes.reports.find((r) => r.code === initialReportCode);
          if (match) setActiveReport(match);
        }
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    }
    void loadInitial();
  }, [orgId, initialReportCode]);

  // Load payroll periods for PAY and ACC reports
  useEffect(() => {
    async function loadPeriods() {
      try {
        const res = await request<{
          periods: Array<{ id: string; code: string; name: string; status: string }>;
        }>(`/api/organizations/${orgId}/payroll/periods`);
        const pList = res.periods || [];
        setPayrollPeriods(pList);
        if (pList.length > 0 && !selectedPeriodId) {
          setSelectedPeriodId(pList[0].id);
        }
      } catch {
        // Silently catch if payroll periods endpoint is unavailable
      }
    }
    void loadPeriods();
  }, [orgId, selectedPeriodId]);

  // Load report data when activeReport or filters change
  useEffect(() => {
    if (!activeReport) return;
    let cancelled = false;

    async function fetchReport() {
      setLoading(true);
      setError(null);
      try {
        let endpoint = '';
        const queryParams = new URLSearchParams();
        queryParams.set('page', String(page));
        queryParams.set('pageSize', String(pageSize));

        if (filterDept) queryParams.set('departmentId', filterDept);
        if (filterSearch) queryParams.set('search', filterSearch);

        if (activeReport?.code === 'RPT-EMP-01') {
          endpoint = `/api/organizations/${orgId}/reports/emp-roster`;
          if (filterStatus) queryParams.set('status', filterStatus);
          if (filterContractType) queryParams.set('contractType', filterContractType);
        } else if (activeReport?.code === 'RPT-ORG-01') {
          endpoint = `/api/organizations/${orgId}/reports/org-structure`;
        } else if (activeReport?.code === 'RPT-ATT-01') {
          endpoint = `/api/organizations/${orgId}/reports/attendance-summary`;
          queryParams.set('startDate', startDate);
          queryParams.set('endDate', endDate);
          if (filterStatus) queryParams.set('status', filterStatus);
        } else if (activeReport?.code === 'RPT-LEAVE-01') {
          endpoint = `/api/organizations/${orgId}/reports/leave-summary`;
          queryParams.set('startDate', startDate);
          queryParams.set('endDate', endDate);
        } else if (activeReport?.code === 'RPT-PAY-01') {
          endpoint = `/api/organizations/${orgId}/reports/payroll-summary`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (filterStatus) queryParams.set('status', filterStatus);
        } else if (activeReport?.code === 'RPT-PAY-02') {
          endpoint = `/api/organizations/${orgId}/reports/payroll-components`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
        } else if (activeReport?.code === 'RPT-PAY-03') {
          endpoint = `/api/organizations/${orgId}/reports/payroll-variance`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (comparePeriodId) queryParams.set('comparePeriodId', comparePeriodId);
        } else if (activeReport?.code === 'RPT-ACC-01') {
          endpoint = `/api/organizations/${orgId}/reports/cost-allocation`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
        } else if (activeReport?.code === 'RPT-ACC-02') {
          endpoint = `/api/organizations/${orgId}/reports/payroll-liabilities`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (filterSettlementStatus) queryParams.set('settlementStatus', filterSettlementStatus);
        } else if (activeReport?.code === 'RPT-ACC-03') {
          endpoint = `/api/organizations/${orgId}/reports/journal-entries`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (filterStatus) queryParams.set('status', filterStatus);
        } else if (activeReport?.code === 'RPT-TAX-01') {
          endpoint = `/api/organizations/${orgId}/reports/tax-summary`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (selectedYear) queryParams.set('year', selectedYear);
          if (selectedMonth) queryParams.set('month', selectedMonth);
        } else if (activeReport?.code === 'RPT-TAX-02') {
          endpoint = `/api/organizations/${orgId}/reports/tax-settlement`;
          if (selectedYear) queryParams.set('year', selectedYear);
        } else if (activeReport?.code === 'RPT-INS-01') {
          endpoint = `/api/organizations/${orgId}/reports/insurance-contributions`;
          if (selectedPeriodId) queryParams.set('periodId', selectedPeriodId);
          if (selectedYear) queryParams.set('year', selectedYear);
          if (selectedMonth) queryParams.set('month', selectedMonth);
        } else if (activeReport?.code === 'RPT-INS-02') {
          endpoint = `/api/organizations/${orgId}/reports/insurance-fluctuations`;
          if (selectedYear) queryParams.set('year', selectedYear);
          if (selectedMonth) queryParams.set('month', selectedMonth);
        } else if (activeReport?.code === 'RPT-LAB-01') {
          endpoint = `/api/organizations/${orgId}/reports/labor-utilization`;
          if (selectedYear) queryParams.set('year', selectedYear);
          if (selectedHalf) queryParams.set('half', selectedHalf);
        }

        if (endpoint) {
          const res = await request<ReportData>(`${endpoint}?${queryParams.toString()}`);
          if (!cancelled) {
            setReportData(res);
          }
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchReport();
    return () => {
      cancelled = true;
    };
  }, [
    activeReport,
    orgId,
    page,
    pageSize,
    filterDept,
    filterStatus,
    filterContractType,
    filterSearch,
    startDate,
    endDate,
    selectedPeriodId,
    comparePeriodId,
    filterSettlementStatus,
    selectedYear,
    selectedHalf,
    selectedMonth,
  ]);

  // Load audit logs if AUDIT tab selected
  useEffect(() => {
    if (selectedCategory === 'AUDIT' && isPrivileged) {
      void request<{ auditLogs: ExportAuditLog[] }>(
        `/api/organizations/${orgId}/reports/export-audit`,
      )
        .then((res) => setAuditLogs(res.auditLogs))
        .catch((err) => setError(errorText(err)));
    }
  }, [selectedCategory, orgId, isPrivileged]);

  // Load saved templates for active report
  useEffect(() => {
    if (activeReport) {
      void request<{ templates: SavedTemplate[] }>(`/api/organizations/${orgId}/reports/templates`)
        .then((res) => {
          setSavedTemplates(res.templates.filter((t) => t.reportCode === activeReport.code));
        })
        .catch(() => {});
    }
  }, [activeReport, orgId]);

  // Preset Date range selection
  function handleDatePreset(preset: string) {
    const today = new Date();
    if (preset === 'THIS_MONTH') {
      setStartDate(
        new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
          .toISOString()
          .slice(0, 10),
      );
      setEndDate(today.toISOString().slice(0, 10));
    } else if (preset === 'LAST_MONTH') {
      const firstLastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const endLastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      setStartDate(firstLastMonth.toISOString().slice(0, 10));
      setEndDate(endLastMonth.toISOString().slice(0, 10));
    } else if (preset === 'THIS_YEAR') {
      setStartDate(new Date(Date.UTC(today.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10));
      setEndDate(today.toISOString().slice(0, 10));
    }
  }

  // Export to CSV
  async function handleExportCsv() {
    if (!activeReport) return;
    setExporting(true);
    setError(null);
    setNotice(null);

    try {
      const filters: Record<string, string> = {};
      if (filterDept) filters.departmentId = filterDept;
      if (filterStatus) filters.status = filterStatus;
      if (filterContractType) filters.contractType = filterContractType;
      if (activeReport.code === 'RPT-ATT-01' || activeReport.code === 'RPT-LEAVE-01') {
        filters.startDate = startDate;
        filters.endDate = endDate;
      }
      if (selectedPeriodId) filters.periodId = selectedPeriodId;
      if (comparePeriodId && activeReport.code === 'RPT-PAY-03')
        filters.comparePeriodId = comparePeriodId;
      if (filterSettlementStatus && activeReport.code === 'RPT-ACC-02')
        filters.settlementStatus = filterSettlementStatus;
      if (selectedYear) filters.year = selectedYear;
      if (selectedHalf) filters.half = selectedHalf;
      if (selectedMonth) filters.month = selectedMonth;

      const response = await fetch(`/api/organizations/${orgId}/reports/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          reportCode: activeReport.code,
          format: 'CSV',
          filters,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ code: 'EXPORT_FAILED' }));
        throw new ApiError(response.status, errorData.code || 'EXPORT_FAILED');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeReport.code}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setNotice(`Xuất báo cáo ${activeReport.code} thành công (định dạng CSV tiếng Việt)!`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setExporting(false);
    }
  }

  // Save current filters as template
  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!activeReport || !templateNameInput.trim()) return;

    try {
      const filters = {
        departmentId: filterDept,
        status: filterStatus,
        contractType: filterContractType,
        startDate,
        endDate,
        periodId: selectedPeriodId,
        comparePeriodId,
        settlementStatus: filterSettlementStatus,
        year: selectedYear,
        half: selectedHalf,
        month: selectedMonth,
      };

      await request(`/api/organizations/${orgId}/reports/templates`, {
        reportCode: activeReport.code,
        templateName: templateNameInput.trim(),
        filters,
      });

      setShowSaveTemplateModal(false);
      setTemplateNameInput('');
      setNotice('Đã lưu mẫu cấu hình bộ lọc thành công!');

      // Reload templates
      const res = await request<{ templates: SavedTemplate[] }>(
        `/api/organizations/${orgId}/reports/templates`,
      );
      setSavedTemplates(res.templates.filter((t) => t.reportCode === activeReport.code));
    } catch (err) {
      setError(errorText(err));
    }
  }

  function applySavedTemplate(tpl: SavedTemplate) {
    if (tpl.filters.departmentId !== undefined) setFilterDept(tpl.filters.departmentId);
    if (tpl.filters.status !== undefined) setFilterStatus(tpl.filters.status);
    if (tpl.filters.contractType !== undefined) setFilterContractType(tpl.filters.contractType);
    if (tpl.filters.startDate !== undefined) setStartDate(tpl.filters.startDate);
    if (tpl.filters.endDate !== undefined) setEndDate(tpl.filters.endDate);
    if (tpl.filters.periodId !== undefined) setSelectedPeriodId(tpl.filters.periodId);
    if (tpl.filters.comparePeriodId !== undefined) setComparePeriodId(tpl.filters.comparePeriodId);
    if (tpl.filters.settlementStatus !== undefined)
      setFilterSettlementStatus(tpl.filters.settlementStatus);
    if (tpl.filters.year !== undefined) setSelectedYear(tpl.filters.year);
    if (tpl.filters.half !== undefined) setSelectedHalf(tpl.filters.half);
    if (tpl.filters.month !== undefined) setSelectedMonth(tpl.filters.month);
    setNotice(`Đã áp dụng mẫu bộ lọc: ${tpl.templateName}`);
  }

  const filteredReports = reports.filter((r) => {
    if (selectedCategory === 'ALL') return true;
    return r.category === selectedCategory;
  });

  return (
    <div className="rpt-container">
      {/* Header */}
      <div className="rpt-header">
        <div>
          <h1>{tr.title}</h1>
          <p>{tr.description}</p>
        </div>
        {!activeReport && selectedCategory !== 'STUDIO' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="primary" onClick={() => setSelectedCategory('STUDIO')}>
              {`+ ${rbMsg.openStudioBtn}`}
            </button>
          </div>
        )}
        {activeReport && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                startTransition(() => {
                  setActiveReport(null);
                  setReportData(null);
                });
              }}
            >
              {tr.catalog}
            </button>
            <button
              type="button"
              className="primary"
              disabled={exporting || loading}
              onClick={handleExportCsv}
            >
              {exporting ? tr.exporting : tr.exportCsv}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="notice success" role="status">
          {notice}
          <button type="button" style={{ float: 'right' }} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button type="button" style={{ float: 'right' }} onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {/* View: Catalog or Active Report */}
      {!activeReport ? (
        <>
          {/* Category Tabs */}
          <div className="rpt-tabs" role="tablist">
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ALL')}
            >
              {tr.all}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'EMPLOYEE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('EMPLOYEE')}
            >
              {tr.employee}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ORGANIZATION' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ORGANIZATION')}
            >
              {tr.organization}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ATTENDANCE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ATTENDANCE')}
            >
              {tr.attendance}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'LEAVE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('LEAVE')}
            >
              {tr.leave}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'PAYROLL' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('PAYROLL')}
            >
              {tr.payroll}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ACCOUNTING' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ACCOUNTING')}
            >
              {tr.accounting}
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'COMPLIANCE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('COMPLIANCE')}
            >
              {tr.compliance}
            </button>
            {isPrivileged && (
              <button
                type="button"
                className={`rpt-tab-btn ${selectedCategory === 'AUDIT' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('AUDIT')}
              >
                {tr.audit}
              </button>
            )}
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'STUDIO' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('STUDIO')}
            >
              {rbMsg.customReportsTab}
            </button>
          </div>

          {/* Custom Reports Studio or Audit Logs or Catalog */}
          {selectedCategory === 'STUDIO' ? (
            <ReportBuilderStudio
              organizationId={orgId}
              currentUserId={profile.user.id}
              userRole={profile.organization.role}
              locale={locale}
              msg={rbMsg}
            />
          ) : selectedCategory === 'AUDIT' ? (
            <div className="rpt-table-container">
              <table className="rpt-table">
                <thead>
                  <tr>
                    <th>{tr.time}</th>
                    <th>{tr.reportCode}</th>
                    <th>{tr.exportedBy}</th>
                    <th>Email</th>
                    <th>{tr.format}</th>
                    <th>{tr.rows}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                        {tr.noAudit}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          {new Date(log.exportedAt).toLocaleString(
                            locale === 'vi' ? 'vi-VN' : 'en-US',
                          )}
                        </td>
                        <td>
                          <strong>{log.reportCode}</strong>
                        </td>
                        <td>{log.userName}</td>
                        <td>{log.userEmail}</td>
                        <td>
                          <span className="rpt-badge">{log.format}</span>
                        </td>
                        <td>
                          {log.rowCount} {tr.rowUnit}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Catalog Grid */
            <div className="rpt-catalog-grid">
              {filteredReports.map((item) => (
                <div
                  key={item.code}
                  className="rpt-card"
                  onClick={() => {
                    startTransition(() => {
                      setActiveReport(item);
                      setPage(1);
                    });
                  }}
                >
                  <div>
                    <div className="rpt-card-top">
                      <span className={`rpt-badge ${item.category.toLowerCase()}`}>
                        {item.code}
                      </span>
                      <span className="rpt-role-badge">Tối thiểu: {item.minRole}</span>
                    </div>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                  </div>
                  <div className="rpt-card-action">
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    >
                      Xem báo cáo →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Report Detail & Execution View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Active Report Header Bar */}
          <div className="rpt-active-bar">
            <div className="rpt-active-bar-title">
              <span className={`rpt-badge ${activeReport.category.toLowerCase()}`}>
                {activeReport.code}
              </span>
              <strong style={{ fontSize: '1.1rem' }}>{activeReport.name}</strong>
            </div>
            {savedTemplates.length > 0 && (
              <div className="rpt-active-bar-templates">
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Mẫu đã lưu:</span>
                <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <SearchableSelect
                    value=""
                    placeholder="Chọn mẫu bộ lọc..."
                    options={savedTemplates.map((t) => ({ value: t.id, label: t.templateName }))}
                    onChange={(val) => {
                      const tpl = savedTemplates.find((t) => t.id === val);
                      if (tpl) applySavedTemplate(tpl);
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Filter Bar */}
          <div className="rpt-filter-bar">
            {/* Date range filters if supported */}
            {(activeReport.code === 'RPT-ATT-01' || activeReport.code === 'RPT-LEAVE-01') && (
              <>
                <div className="rpt-filter-group">
                  <label>{tr.dateRange}</label>
                  <select
                    onChange={(e) => handleDatePreset(e.target.value)}
                    defaultValue="THIS_MONTH"
                  >
                    <option value="THIS_MONTH">{tr.thisMonth}</option>
                    <option value="LAST_MONTH">{tr.lastMonth}</option>
                    <option value="THIS_YEAR">{tr.thisYear}</option>
                    <option value="CUSTOM">{tr.custom}</option>
                  </select>
                </div>
                <div className="rpt-filter-group">
                  <label>{tr.fromDate}</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="rpt-filter-group">
                  <label>{tr.toDate}</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            {/* Period Filter for Payroll & Accounting */}
            {activeReport.supportedFilters.includes('periodId') && (
              <div className="rpt-filter-group">
                <label>{tr.period}</label>
                <SearchableSelect
                  ariaLabel={tr.period}
                  value={selectedPeriodId}
                  placeholder={tr.noPeriod}
                  options={payrollPeriods.map((p) => ({
                    value: p.id,
                    label: `${p.code} - ${p.name} (${p.status})`,
                    keywords: `${p.code} ${p.name} ${p.status}`,
                  }))}
                  onChange={(val) => {
                    setSelectedPeriodId(val);
                    setPage(1);
                  }}
                />
              </div>
            )}

            {/* Compare Period for RPT-PAY-03 */}
            {activeReport.code === 'RPT-PAY-03' && (
              <div className="rpt-filter-group">
                <label>{tr.comparePeriod}</label>
                <SearchableSelect
                  ariaLabel={tr.comparePeriod}
                  value={comparePeriodId}
                  options={[
                    { value: '', label: tr.previousPeriod },
                    ...payrollPeriods
                      .filter((p) => p.id !== selectedPeriodId)
                      .map((p) => ({
                        value: p.id,
                        label: `${p.code} - ${p.name}`,
                        keywords: `${p.code} ${p.name}`,
                      })),
                  ]}
                  onChange={(val) => {
                    setComparePeriodId(val);
                    setPage(1);
                  }}
                />
              </div>
            )}

            {/* Department Filter */}
            {activeReport.supportedFilters.includes('departmentId') && (
              <div className="rpt-filter-group">
                <label>{tr.department}</label>
                <SearchableSelect
                  ariaLabel={tr.department}
                  value={filterDept}
                  options={[
                    { value: '', label: tr.allDepartments },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: `${d.name} (${d.code})`,
                      keywords: `${d.name} ${d.code}`,
                    })),
                  ]}
                  onChange={(val) => {
                    setFilterDept(val);
                    setPage(1);
                  }}
                />
              </div>
            )}

            {/* Status Filter for EMP or ATT */}
            {activeReport.code === 'RPT-EMP-01' && (
              <div className="rpt-filter-group">
                <label>{tr.status}</label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{tr.allStatuses}</option>
                  <option value="ACTIVE">{tr.active}</option>
                  <option value="ON_LEAVE">{tr.onLeave}</option>
                  <option value="TERMINATED">{tr.terminated}</option>
                </select>
              </div>
            )}

            {activeReport.code === 'RPT-ATT-01' && (
              <div className="rpt-filter-group">
                <label>Chuyên cần</label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tất cả</option>
                  <option value="ON_TIME">Đúng giờ</option>
                  <option value="LATE">Đi muộn</option>
                  <option value="EARLY_LEAVE">Về sớm</option>
                  <option value="ABSENT">Vắng mặt</option>
                </select>
              </div>
            )}

            {/* Settlement Status for RPT-ACC-02 */}
            {activeReport.code === 'RPT-ACC-02' && (
              <div className="rpt-filter-group">
                <label>Trạng thái thanh toán</label>
                <select
                  value={filterSettlementStatus}
                  onChange={(e) => {
                    setFilterSettlementStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{tr.allStatuses}</option>
                  <option value="SETTLED">Đã thanh toán đủ (SETTLED)</option>
                  <option value="PARTIAL">Thanh toán một phần (PARTIAL)</option>
                  <option value="UNPAID">Chưa thanh toán (UNPAID)</option>
                </select>
              </div>
            )}

            {/* Journal Entry Status for RPT-ACC-03 */}
            {activeReport.code === 'RPT-ACC-03' && (
              <div className="rpt-filter-group">
                <label>Trạng thái bút toán</label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{tr.allStatuses}</option>
                  <option value="POSTED">Đã ghi sổ (POSTED)</option>
                  <option value="DRAFT">Dự thảo (DRAFT)</option>
                  <option value="REVERSED">Đã đảo sổ (REVERSED)</option>
                </select>
              </div>
            )}

            {/* Slip Status for RPT-PAY-01 */}
            {activeReport.code === 'RPT-PAY-01' && (
              <div className="rpt-filter-group">
                <label>Trạng thái phiếu lương</label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tất cả</option>
                  <option value="DRAFT">Nháp (DRAFT)</option>
                  <option value="CONFIRMED">Đã xác nhận (CONFIRMED)</option>
                  <option value="PAID">Đã thanh toán (PAID)</option>
                </select>
              </div>
            )}

            {/* Contract Type for EMP */}
            {activeReport.code === 'RPT-EMP-01' && (
              <div className="rpt-filter-group">
                <label>Loại hợp đồng</label>
                <select
                  value={filterContractType}
                  onChange={(e) => {
                    setFilterContractType(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tất cả loại HĐ</option>
                  <option value="INDEFINITE">Không xác định thời hạn</option>
                  <option value="FIXED_TERM">Xác định thời hạn</option>
                  <option value="PROBATION">Thử việc</option>
                </select>
              </div>
            )}

            {/* Year Filter */}
            {activeReport.supportedFilters.includes('year') && (
              <div className="rpt-filter-group">
                <label>{tr.year}</label>
                <select
                  aria-label={tr.year}
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setPage(1);
                  }}
                >
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={String(y)}>
                      Năm {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Month Filter */}
            {activeReport.supportedFilters.includes('month') && (
              <div className="rpt-filter-group">
                <label>{tr.month}</label>
                <input
                  aria-label={tr.month}
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            )}

            {/* Half Filter */}
            {activeReport.supportedFilters.includes('half') && (
              <div className="rpt-filter-group">
                <label>{tr.half}</label>
                <select
                  aria-label={tr.half}
                  value={selectedHalf}
                  onChange={(e) => {
                    setSelectedHalf(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="1">{tr.half1}</option>
                  <option value="2">{tr.half2}</option>
                </select>
              </div>
            )}

            {/* Keyword Search */}
            {activeReport.supportedFilters.includes('search') && (
              <div className="rpt-filter-group">
                <label>{tr.search}</label>
                <input
                  type="text"
                  placeholder={tr.searchPlaceholder}
                  value={filterSearch}
                  onChange={(e) => {
                    setFilterSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            )}

            <div className="rpt-filter-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setShowSaveTemplateModal(true)}
              >
                ★ Lưu bộ lọc
              </button>
            </div>
          </div>

          {/* Modal: Save Template */}
          {showSaveTemplateModal && (
            <SlideDialog
              label={tr.saveTemplate}
              onClose={() => setShowSaveTemplateModal(false)}
              action={
                <button type="submit" form="save-report-template" className="primary">
                  {tr.save}
                </button>
              }
            >
              <h3 style={{ margin: '0 0 1rem 0' }}>{tr.saveTemplate}</h3>
              <form id="save-report-template" onSubmit={handleSaveTemplate}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    marginBottom: '0.5rem',
                    color: '#475569',
                  }}
                >
                  {tr.templateName}
                  <input
                    type="text"
                    required
                    value={templateNameInput}
                    onChange={(e) => setTemplateNameInput(e.target.value)}
                    placeholder={tr.templatePlaceholder}
                    style={{
                      width: '100%',
                      marginTop: '0.3rem',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </label>
              </form>
            </SlideDialog>
          )}

          {/* KPI Summary Cards */}
          {reportData?.metrics && (
            <div className="rpt-kpi-grid">
              {activeReport.code === 'RPT-EMP-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng nhân sự</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalEmployees}</div>
                    <div className="rpt-kpi-sub">Toàn bộ hồ sơ trong phạm vi</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">{tr.active}</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {reportData.metrics.activeEmployees}
                    </div>
                    <div className="rpt-kpi-sub">Trạng thái ACTIVE</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">{tr.terminated}</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>
                      {reportData.metrics.terminatedEmployees}
                    </div>
                    <div className="rpt-kpi-sub">Trạng thái TERMINATED</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Thâm niên trung bình</div>
                    <div className="rpt-kpi-value">
                      {reportData.metrics.averageTenureMonths}{' '}
                      <span style={{ fontSize: '0.9rem' }}>tháng</span>
                    </div>
                    <div className="rpt-kpi-sub">Tính từ ngày ký hợp đồng</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ORG-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng số phòng ban</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalDepartments}</div>
                    <div className="rpt-kpi-sub">Phòng ban tổ chức</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng vị trí chức danh</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalPositions}</div>
                    <div className="rpt-kpi-sub">Vị trí đang hoạt động</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Nhân sự đã gán phòng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.totalAssignedEmployees}
                    </div>
                    <div className="rpt-kpi-sub">Nhân viên trực thuộc</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Có trưởng phòng</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {reportData.metrics.departmentsWithManager} /{' '}
                      {reportData.metrics.totalDepartments}
                    </div>
                    <div className="rpt-kpi-sub">Độ bao phủ quản lý</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ATT-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng số ca làm việc</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalSchedules}</div>
                    <div className="rpt-kpi-sub">Ca kế hoạch trong kỳ</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Có mặt đúng giờ</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {reportData.metrics.onTimeCount}
                    </div>
                    <div className="rpt-kpi-sub">Trong giới hạn ân hạn</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đi muộn / Về sớm</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {reportData.metrics.lateCount} / {reportData.metrics.earlyLeaveCount}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.totalLateMinutes}p muộn,{' '}
                      {reportData.metrics.totalEarlyMinutes}p sớm
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ chuyên cần</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.attendanceRate}%
                    </div>
                    <div className="rpt-kpi-sub">Hiện diện trên tổng ca</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-LEAVE-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng hạn mức phép</div>
                    <div className="rpt-kpi-value">
                      {reportData.metrics.totalAllowanceDays}{' '}
                      <span style={{ fontSize: '0.9rem' }}>ngày</span>
                    </div>
                    <div className="rpt-kpi-sub">Phép cấp trong năm</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phép đã sử dụng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.totalChargedDays}{' '}
                      <span style={{ fontSize: '0.9rem' }}>ngày</span>
                    </div>
                    <div className="rpt-kpi-sub">Đơn phép đã duyệt</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Số dư phép còn lại</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {reportData.metrics.totalRemainingDays}{' '}
                      <span style={{ fontSize: '0.9rem' }}>ngày</span>
                    </div>
                    <div className="rpt-kpi-sub">Hạn mức khả dụng</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ sử dụng phép</div>
                    <div className="rpt-kpi-value">
                      {reportData.metrics.overallUtilizationRate}%
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.approvedRequests} đơn đã duyệt
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng thực lĩnh (Net)</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {formatVND(reportData.metrics.totalNetPay)}
                    </div>
                    <div className="rpt-kpi-sub">{reportData.metrics.slipCount} phiếu lương</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng lương Gross</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalGrossPay)}
                    </div>
                    <div className="rpt-kpi-sub">Lương gộp trước khấu trừ</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng khấu trừ</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>
                      {formatVND(reportData.metrics.totalDeductions)}
                    </div>
                    <div className="rpt-kpi-sub">Bảo hiểm & Thuế TNCN</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp & Thưởng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {formatVND(reportData.metrics.totalAllowances)}
                    </div>
                    <div className="rpt-kpi-sub">
                      Thưởng: {formatVND(reportData.metrics.totalBonuses)}
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp miễn thuế</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {formatVND(reportData.metrics.totalNonTaxableAllowances)}
                    </div>
                    <div className="rpt-kpi-sub">Ăn ca, điện thoại, trang phục...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp tính thuế</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalTaxableAllowances)}
                    </div>
                    <div className="rpt-kpi-sub">Chức vụ, trách nhiệm...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Khấu trừ bảo hiểm NLĐ (10.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>
                      {formatVND(reportData.metrics.totalStatutoryDeductions)}
                    </div>
                    <div className="rpt-kpi-sub">BHXH 8%, BHYT 1.5%, BHTN 1%</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Thuế TNCN khấu trừ</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {formatVND(reportData.metrics.totalPitDeductions)}
                    </div>
                    <div className="rpt-kpi-sub">
                      Thưởng: {formatVND(reportData.metrics.totalBonuses)}
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-03' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Biến động quỹ lương Net</div>
                    <div
                      className="rpt-kpi-value"
                      style={{
                        color:
                          Number(reportData.metrics.netPayVariancePct) >= 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {Number(reportData.metrics.netPayVariancePct) >= 0 ? '+' : ''}
                      {reportData.metrics.netPayVariancePct}%
                    </div>
                    <div className="rpt-kpi-sub">
                      Chênh lệch: {formatVND(reportData.metrics.netPayDelta)}
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Biến động nhân sự</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {Number(reportData.metrics.headcountDelta) >= 0 ? '+' : ''}
                      {reportData.metrics.headcountDelta}{' '}
                      <span style={{ fontSize: '0.9rem' }}>người</span>
                    </div>
                    <div className="rpt-kpi-sub">So với kỳ trước</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Bình quân chênh lệch/NV</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.avgPayDeltaPerEmployee)}
                    </div>
                    <div className="rpt-kpi-sub">Mức tăng/giảm TB</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Cảnh báo biến động &ge;20%</div>
                    <div
                      className="rpt-kpi-value"
                      style={{
                        color:
                          Number(reportData.metrics.anomalousCount) > 0 ? '#d97706' : '#16a34a',
                      }}
                    >
                      {reportData.metrics.anomalousCount}{' '}
                      <span style={{ fontSize: '0.9rem' }}>nhân sự</span>
                    </div>
                    <div className="rpt-kpi-sub">Cần rà soát biến động lớn</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ACC-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng chi phí nhân sự (CTC)</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {formatVND(reportData.metrics.totalCostToCompany)}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.departmentCount} phòng ban
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Lương Gross ghi nhận</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalGrossPay)}
                    </div>
                    <div className="rpt-kpi-sub">Chi phí lương nhân viên</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">BHXH/YT/TN Doanh nghiệp (21.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {formatVND(reportData.metrics.totalEmployerSocialInsurance)}
                    </div>
                    <div className="rpt-kpi-sub">Khoản bắt buộc người SDLĐ</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Kinh phí công đoàn (2%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#64748b' }}>
                      {formatVND(reportData.metrics.totalTradeUnionFee)}
                    </div>
                    <div className="rpt-kpi-sub">Đóng theo quy định</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ACC-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Lương phải trả (TK 3341)</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalNetPayable)}
                    </div>
                    <div className="rpt-kpi-sub">Tổng nghĩa vụ chi trả</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đã chi trả thực tế</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {formatVND(reportData.metrics.totalDisbursed)}
                    </div>
                    <div className="rpt-kpi-sub">TK 1121 / 1111</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Còn phải trả (Dư Có TK 3341)</div>
                    <div
                      className="rpt-kpi-value"
                      style={{
                        color:
                          Number(reportData.metrics.totalRemainingBalance) > 0
                            ? '#dc2626'
                            : '#16a34a',
                      }}
                    >
                      {formatVND(reportData.metrics.totalRemainingBalance)}
                    </div>
                    <div className="rpt-kpi-sub">Chưa thanh toán hoàn tất</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ thanh toán</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.settlementRate}%
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.settledSlipsCount} đã trả /{' '}
                      {reportData.metrics.unsettledSlipsCount} chưa trả
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ACC-03' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng phát sinh Nợ</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalDebit)}</div>
                    <div className="rpt-kpi-sub">TK 6421, 6422, 334...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng phát sinh Có</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalCredit)}</div>
                    <div className="rpt-kpi-sub">TK 334, 338, 1121...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Cân đối Nợ = Có</div>
                    <div
                      className="rpt-kpi-value"
                      style={{ color: reportData.metrics.isBalanced ? '#16a34a' : '#dc2626' }}
                    >
                      {reportData.metrics.isBalanced ? '✓ CÂN ĐỐI' : '⚠ LỆCH'}
                    </div>
                    <div className="rpt-kpi-sub">
                      Chênh lệch: {formatVND(reportData.metrics.balanceDelta)}
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Bút toán đã ghi sổ</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.postedEntriesCount} /{' '}
                      {reportData.metrics.totalEntriesCount}
                    </div>
                    <div className="rpt-kpi-sub">Trạng thái POSTED</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-TAX-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng thu nhập chịu thuế</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalTaxableIncome)}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.taxableEmployeeCount} / {reportData.metrics.employeeCount}{' '}
                      NLĐ phát sinh thuế
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng giảm trừ gia cảnh & BH</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {formatVND(reportData.metrics.totalDeductions)}
                    </div>
                    <div className="rpt-kpi-sub">Bản thân 11M, Phụ thuộc 4.4M/người</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Thuế TNCN phát sinh (Biểu lũy tiến)</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {formatVND(reportData.metrics.totalPitTax)}
                    </div>
                    <div className="rpt-kpi-sub">Mẫu 05/KK-TNCN (TT 80/2021)</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đối chiếu phiếu lương</div>
                    <div
                      className="rpt-kpi-value"
                      style={{
                        color:
                          Number(reportData.metrics.varianceCount) === 0 ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {Number(reportData.metrics.varianceCount) === 0
                        ? '✓ KHỚP 100%'
                        : '⚠ LỆCH ' + formatVND(reportData.metrics.totalVariance)}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.varianceCount} sai lệch vs bảng lương chốt
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-TAX-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng thu nhập chịu thuế năm</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalAnnualIncome)}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.employeeCount} nhân sự quyết toán
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng thuế đã khấu trừ trong năm</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {formatVND(reportData.metrics.totalTaxWithheld)}
                    </div>
                    <div className="rpt-kpi-sub">Khấu trừ 12 tháng tại nguồn</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Nghĩa vụ thuế quyết toán năm</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {formatVND(reportData.metrics.totalTaxLiability)}
                    </div>
                    <div className="rpt-kpi-sub">Mẫu 05/QTT-TNCN & 05-1/BK-TNCN</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Cân đối Quyết toán (Hoàn / Nộp thêm)</div>
                    <div
                      className="rpt-kpi-value"
                      style={{
                        color:
                          Number(reportData.metrics.totalRefundAmount) > 0
                            ? '#16a34a'
                            : Number(reportData.metrics.totalAdditionalTaxPayable) > 0
                              ? '#dc2626'
                              : '#64748b',
                      }}
                    >
                      {Number(reportData.metrics.totalRefundAmount) > 0
                        ? `Hoàn: ${formatVND(reportData.metrics.totalRefundAmount)}`
                        : Number(reportData.metrics.totalAdditionalTaxPayable) > 0
                          ? `Nộp thêm: ${formatVND(reportData.metrics.totalAdditionalTaxPayable)}`
                          : 'Cân đối (0 ₫)'}
                    </div>
                    <div className="rpt-kpi-sub">
                      {reportData.metrics.authorizedCount} hồ sơ ủy quyền QTT
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-INS-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng kinh phí trích nộp (34%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {formatVND(reportData.metrics.totalRemittance)}
                    </div>
                    <div className="rpt-kpi-sub">BH 32% + Kinh phí Công đoàn 2%</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Người lao động đóng (10.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>
                      {formatVND(reportData.metrics.totalEmployeeShare)}
                    </div>
                    <div className="rpt-kpi-sub">BHXH 8%, BHYT 1.5%, BHTN 1%</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Doanh nghiệp đóng (21.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>
                      {formatVND(reportData.metrics.totalEmployerShare)}
                    </div>
                    <div className="rpt-kpi-sub">BHXH 17.5%, BHYT 3%, BHTN 1%</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Kinh phí Công đoàn (2%)</div>
                    <div className="rpt-kpi-value">
                      {formatVND(reportData.metrics.totalTradeUnion)}
                    </div>
                    <div className="rpt-kpi-sub">
                      {Number(reportData.metrics.varianceCount) === 0
                        ? '✓ Khớp hoàn toàn bảng lương'
                        : `⚠ Lệch ${formatVND(reportData.metrics.totalVariance)}`}
                    </div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-INS-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng lượt biến động BH</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalFluctuations}</div>
                    <div className="rpt-kpi-sub">Mẫu D02-LT (QĐ 595/QĐ-BHXH)</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Báo tăng lao động</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      +{reportData.metrics.increaseCount}
                    </div>
                    <div className="rpt-kpi-sub">Tuyển dụng mới & tái tham gia</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Báo giảm lao động</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>
                      -{reportData.metrics.decreaseCount}
                    </div>
                    <div className="rpt-kpi-sub">Chấm dứt HĐLĐ & tạm hoãn</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Điều chỉnh mức đóng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.salaryAdjustmentCount}
                    </div>
                    <div className="rpt-kpi-sub">Tăng / giảm lương đóng BH</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-LAB-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng số lao động</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalEmployees}</div>
                    <div className="rpt-kpi-sub">Mẫu 01/PLI (NĐ 145/2020)</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Lao động nữ</div>
                    <div className="rpt-kpi-value" style={{ color: '#9333ea' }}>
                      {reportData.metrics.femaleEmployees}
                    </div>
                    <div className="rpt-kpi-sub">
                      {Number(reportData.metrics.totalEmployees) > 0
                        ? Math.round(
                            (Number(reportData.metrics.femaleEmployees) /
                              Number(reportData.metrics.totalEmployees)) *
                              100,
                          )
                        : 0}
                      % tổng nhân sự
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">HĐ không xác định thời hạn</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>
                      {reportData.metrics.indefiniteContractCount}
                    </div>
                    <div className="rpt-kpi-sub">
                      Xác định TH: {reportData.metrics.fixedTermContractCount} | Thử việc:{' '}
                      {reportData.metrics.probationContractCount}
                    </div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Biến động trong kỳ báo cáo</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      +{reportData.metrics.newHiresInPeriod} / -
                      {reportData.metrics.terminationsInPeriod}
                    </div>
                    <div className="rpt-kpi-sub">Tuyển mới / Thôi việc trong kỳ</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Data Table */}
          <div className="rpt-table-container">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                Đang tổng hợp dữ liệu báo cáo...
              </div>
            ) : (
              <>
                {/* RPT-EMP-01 Table */}
                {activeReport.code === 'RPT-EMP-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Chức danh</th>
                        <th>{tr.status}</th>
                        <th>Hợp đồng</th>
                        <th>Ngày vào làm</th>
                        <th>Thâm niên</th>
                        <th>Số điện thoại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu nhân sự phù hợp.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.positionTitle}</td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(item.employmentStatus ?? '').toLowerCase()}`}
                              >
                                {item.employmentStatus}
                              </span>
                            </td>
                            <td>
                              {item.contractType} ({item.contractNumber})
                            </td>
                            <td>{item.hireDate}</td>
                            <td>{item.tenureMonths} tháng</td>
                            <td>{item.phone || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-ORG-01 Table */}
                {activeReport.code === 'RPT-ORG-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã PB</th>
                        <th>Tên phòng ban</th>
                        <th>Cấp trên</th>
                        <th>Trưởng bộ phận</th>
                        <th>{tr.status}</th>
                        <th>Nhân sự</th>
                        <th>Vị trí chức danh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu phòng ban.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.code}</strong>
                            </td>
                            <td>{item.name}</td>
                            <td>{item.parentName}</td>
                            <td>{item.managerName}</td>
                            <td>
                              <span
                                className={`rpt-status-pill ${item.isActive ? 'rpt-status-active' : 'rpt-status-terminated'}`}
                              >
                                {item.isActive ? 'Hoạt động' : 'Tạm dừng'}
                              </span>
                            </td>
                            <td>
                              <strong>{item.employeeCount}</strong> nhân viên
                            </td>
                            <td>
                              <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                                {item.positionCount} vị trí:{' '}
                              </span>
                              {item.positions?.map((p) => p.title).join(', ') || 'Chưa cấu hình'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-ATT-01 Table */}
                {activeReport.code === 'RPT-ATT-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Ca làm việc</th>
                        <th>Giờ vào</th>
                        <th>Giờ ra</th>
                        <th>{tr.status}</th>
                        <th>Muộn/Sớm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu chấm công trong khoảng thời gian này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.scheduleId}>
                            <td>{item.workDate}</td>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.shiftName}</td>
                            <td>
                              {item.checkedInAt
                                ? new Date(item.checkedInAt).toLocaleTimeString('vi-VN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </td>
                            <td>
                              {item.checkedOutAt
                                ? new Date(item.checkedOutAt).toLocaleTimeString('vi-VN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(item.status ?? '').toLowerCase()}`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td>
                              {Number(item.lateMinutes) > 0 ? `+${item.lateMinutes}p muộn` : ''}{' '}
                              {Number(item.earlyMinutes) > 0 ? `-${item.earlyMinutes}p sớm` : ''}{' '}
                              {!item.lateMinutes && !item.earlyMinutes ? '—' : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-LEAVE-01 Table (Balances) */}
                {activeReport.code === 'RPT-LEAVE-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Loại nghỉ phép</th>
                        <th>Hạn mức (ngày)</th>
                        <th>Đã nghỉ (ngày)</th>
                        <th>Còn lại (ngày)</th>
                        <th>Tỷ lệ sử dụng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.balances?.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu số dư phép.
                          </td>
                        </tr>
                      ) : (
                        reportData?.balances?.map((b, idx) => (
                          <tr key={`${b.employeeId}-${b.leaveTypeId}-${idx}`}>
                            <td>
                              <strong>{b.employeeCode}</strong>
                            </td>
                            <td>{b.fullName}</td>
                            <td>{b.departmentName}</td>
                            <td>{b.leaveTypeName}</td>
                            <td>{b.allowanceDays}</td>
                            <td>
                              <span style={{ color: '#2563eb', fontWeight: 600 }}>
                                {b.chargedDays}
                              </span>
                            </td>
                            <td>
                              <strong style={{ color: '#16a34a' }}>{b.remainingDays}</strong>
                            </td>
                            <td>{b.utilizationRate}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-PAY-01 Table */}
                {activeReport.code === 'RPT-PAY-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Lương cơ bản</th>
                        <th>Ngày công</th>
                        <th>Lương Gross</th>
                        <th>Phụ cấp</th>
                        <th>Thưởng</th>
                        <th>Khấu trừ</th>
                        <th>Thực lĩnh (Net)</th>
                        <th>{tr.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu phiếu lương trong kỳ này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.id || item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.baseSalary)}</td>
                            <td>
                              {item.actualWorkingDays} / {item.standardDays}
                            </td>
                            <td>
                              <strong>{formatVND(item.grossPay)}</strong>
                            </td>
                            <td>{formatVND(item.totalAllowances)}</td>
                            <td>{formatVND(item.totalBonuses)}</td>
                            <td style={{ color: '#dc2626' }}>{formatVND(item.totalDeductions)}</td>
                            <td>
                              <strong style={{ color: '#16a34a' }}>{formatVND(item.netPay)}</strong>
                            </td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(item.status || 'draft').toLowerCase()}`}
                              >
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-PAY-02 Table */}
                {activeReport.code === 'RPT-PAY-02' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>PC miễn thuế</th>
                        <th>PC tính thuế</th>
                        <th>Thưởng</th>
                        <th>BHXH/YT/TN NLĐ</th>
                        <th>Thuế TNCN</th>
                        <th>Khấu trừ khác</th>
                        <th>Lương Gross</th>
                        <th>Thực lĩnh (Net)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu cơ cấu lương.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.nonTaxableAllowances)}</td>
                            <td>{formatVND(item.taxableAllowances)}</td>
                            <td>{formatVND(item.totalBonuses)}</td>
                            <td style={{ color: '#dc2626' }}>
                              {formatVND(item.statutoryDeductions)}
                            </td>
                            <td style={{ color: '#d97706' }}>{formatVND(item.pitDeduction)}</td>
                            <td>{formatVND(item.otherDeductions)}</td>
                            <td>
                              <strong>{formatVND(item.grossPay)}</strong>
                            </td>
                            <td>
                              <strong style={{ color: '#16a34a' }}>{formatVND(item.netPay)}</strong>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-PAY-03 Table */}
                {activeReport.code === 'RPT-PAY-03' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Kỳ trước (Net)</th>
                        <th>Kỳ này (Net)</th>
                        <th>Chênh lệch (VNĐ)</th>
                        <th>Tỷ lệ (%)</th>
                        <th>Cảnh báo biến động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu biến động giữa hai kỳ.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.compareNetPay)}</td>
                            <td>
                              <strong>{formatVND(item.currentNetPay)}</strong>
                            </td>
                            <td
                              style={{
                                color: Number(item.varianceAmount) >= 0 ? '#16a34a' : '#dc2626',
                              }}
                            >
                              {Number(item.varianceAmount) >= 0 ? '+' : ''}
                              {formatVND(item.varianceAmount)}
                            </td>
                            <td>
                              {Number(item.variancePct) >= 0 ? '+' : ''}
                              {item.variancePct}%
                            </td>
                            <td>
                              {item.isAnomalous ? (
                                <span
                                  className="rpt-status-pill rpt-status-late"
                                  style={{ fontWeight: 700 }}
                                >
                                  ⚠ Biến động &ge; 20%
                                </span>
                              ) : (
                                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                  Bình thường
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-ACC-01 Table */}
                {activeReport.code === 'RPT-ACC-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã PB</th>
                        <th>Tên phòng ban</th>
                        <th>Tài khoản VAS</th>
                        <th>Nhân sự</th>
                        <th>Lương Gross</th>
                        <th>BH bắt buộc DN (21.5%)</th>
                        <th>Kinh phí CĐ (2%)</th>
                        <th>Tổng chi phí CTC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reportData?.departments || reportData?.items || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu phân bổ chi phí.
                          </td>
                        </tr>
                      ) : (
                        (reportData?.departments || reportData?.items || []).map((item) => (
                          <tr key={item.departmentCode || item.departmentId}>
                            <td>
                              <strong>{item.departmentCode}</strong>
                            </td>
                            <td>{item.departmentName}</td>
                            <td>
                              <span className="rpt-badge accounting">
                                {item.vasAccountFull || item.vasAccount}
                              </span>
                            </td>
                            <td>{item.headcount} người</td>
                            <td>{formatVND(item.grossSalary || item.grossPay)}</td>
                            <td>{formatVND(item.employerInsurance || item.employerStatutory)}</td>
                            <td>{formatVND(item.employerUnion || item.tradeUnion)}</td>
                            <td>
                              <strong style={{ color: '#2563eb' }}>
                                {formatVND(item.totalCostToCompany)}
                              </strong>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-ACC-02 Table */}
                {activeReport.code === 'RPT-ACC-02' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>{tr.department}</th>
                        <th>Ngân hàng</th>
                        <th>Số tài khoản</th>
                        <th>Phải trả (TK 3341)</th>
                        <th>Đã chi trả thực tế</th>
                        <th>Còn phải trả</th>
                        <th>Trạng thái thanh toán</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu công nợ lương.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.bankName}</td>
                            <td>
                              <code>{item.bankAccountNumber}</code>
                            </td>
                            <td>
                              <strong>{formatVND(item.netPayable)}</strong>
                            </td>
                            <td style={{ color: '#16a34a' }}>{formatVND(item.totalPaid)}</td>
                            <td>
                              <strong
                                style={{
                                  color: Number(item.remainingBalance) > 0 ? '#dc2626' : '#16a34a',
                                }}
                              >
                                {formatVND(item.remainingBalance)}
                              </strong>
                            </td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(item.settlementStatus || 'unpaid').toLowerCase()}`}
                              >
                                {item.settlementStatus}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-ACC-03 Table */}
                {activeReport.code === 'RPT-ACC-03' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Số bút toán</th>
                        <th>Ngày ghi sổ</th>
                        <th>Diễn giải</th>
                        <th>Định khoản chi tiết (Nợ / Có)</th>
                        <th>Tổng phát sinh</th>
                        <th>{tr.status}</th>
                        <th>Người ghi sổ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu sổ nhật ký bút toán.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((entry) => (
                          <tr key={entry.id}>
                            <td>
                              <strong>{entry.entryNumber}</strong>
                            </td>
                            <td>{entry.entryDate}</td>
                            <td>{entry.description}</td>
                            <td style={{ minWidth: '280px' }}>
                              {entry.lines?.map((line, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    fontSize: '0.8rem',
                                    lineHeight: '1.4',
                                    padding: '2px 0',
                                  }}
                                >
                                  {Number(line.debitAmount) > 0 ? (
                                    <span>
                                      <strong>Nợ {line.accountCode}</strong> ({line.accountName}):{' '}
                                      {formatVND(line.debitAmount)}
                                    </span>
                                  ) : (
                                    <span style={{ paddingLeft: '1rem' }}>
                                      Có {line.accountCode} ({line.accountName}):{' '}
                                      {formatVND(line.creditAmount)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </td>
                            <td>
                              <div>
                                Nợ: <strong>{formatVND(entry.totalDebit)}</strong>
                              </div>
                              <div>
                                Có: <strong>{formatVND(entry.totalCredit)}</strong>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(entry.status || 'draft').toLowerCase()}`}
                              >
                                {entry.status}
                              </span>
                              {entry.reversalEntryNumber && (
                                <div style={{ fontSize: '0.75rem', color: '#dc2626' }}>
                                  Đảo bởi: {entry.reversalEntryNumber}
                                </div>
                              )}
                            </td>
                            <td>
                              <div>{entry.postedByName}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {entry.postedAt
                                  ? new Date(entry.postedAt).toLocaleDateString('vi-VN')
                                  : ''}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-TAX-01 Table (Mẫu 05/KK-TNCN) */}
                {activeReport.code === 'RPT-TAX-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>Mã số thuế</th>
                        <th>Tổng TN</th>
                        <th>TN chịu thuế</th>
                        <th>Giảm trừ gia cảnh</th>
                        <th>Giảm trừ BH</th>
                        <th>TN tính thuế</th>
                        <th>Thuế TNCN (Biểu lũy tiến)</th>
                        <th>Thuế đã trừ (Slip)</th>
                        <th>Chênh lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={12} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu tổng hợp thuế TNCN cho kỳ/thời gian này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.taxCode || '—'}</td>
                            <td>{formatVND(item.grossIncome)}</td>
                            <td>
                              <strong>{formatVND(item.taxableIncome)}</strong>
                            </td>
                            <td>
                              {formatVND(
                                Number(item.personalDeduction || 0) +
                                  Number(item.dependentDeductions || 0),
                              )}
                              {Number(item.dependentCount) > 0 && (
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                  {item.dependentCount} người phụ thuộc
                                </div>
                              )}
                            </td>
                            <td>{formatVND(item.insuranceDeductions)}</td>
                            <td>{formatVND(item.assessableIncome)}</td>
                            <td>
                              <strong style={{ color: '#d97706' }}>
                                {formatVND(item.calculatedPitTax)}
                              </strong>
                            </td>
                            <td>{formatVND(item.slipPitTax)}</td>
                            <td>
                              {Number(item.variance) !== 0 ? (
                                <strong style={{ color: '#dc2626' }}>
                                  {formatVND(item.variance)}
                                </strong>
                              ) : (
                                <span style={{ color: '#16a34a' }}>0 ₫</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-TAX-02 Table (Mẫu 05/QTT-TNCN) */}
                {activeReport.code === 'RPT-TAX-02' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>MST / CCCD</th>
                        <th>Tháng LV</th>
                        <th>Tổng TN năm</th>
                        <th>Tổng giảm trừ</th>
                        <th>TN tính thuế</th>
                        <th>Thuế phải nộp năm</th>
                        <th>Đã khấu trừ</th>
                        <th>Cân đối Quyết toán</th>
                        <th>Ủy quyền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={12} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu quyết toán thuế TNCN cho năm này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>
                              <div>{item.taxCode || '—'}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {item.idNumber || ''}
                              </div>
                            </td>
                            <td>{item.monthsWorked} tháng</td>
                            <td>
                              <strong>{formatVND(item.annualGrossIncome)}</strong>
                            </td>
                            <td>
                              {formatVND(
                                Number(item.annualPersonalDeduction || 0) +
                                  Number(item.annualDependentDeduction || 0) +
                                  Number(item.annualInsuranceDeductions || 0),
                              )}
                            </td>
                            <td>{formatVND(item.annualAssessableIncome)}</td>
                            <td>
                              <strong style={{ color: '#d97706' }}>
                                {formatVND(item.annualTaxLiability)}
                              </strong>
                            </td>
                            <td style={{ color: '#2563eb' }}>
                              {formatVND(item.taxAlreadyWithheld)}
                            </td>
                            <td>
                              {item.settlementType === 'REFUND' ? (
                                <strong style={{ color: '#16a34a' }}>
                                  Hoàn: {formatVND(Math.abs(Number(item.taxBalance)))}
                                </strong>
                              ) : item.settlementType === 'PAYABLE' ? (
                                <strong style={{ color: '#dc2626' }}>
                                  Nộp: {formatVND(item.taxBalance)}
                                </strong>
                              ) : (
                                <span style={{ color: '#64748b' }}>0 ₫</span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`rpt-status-pill ${item.proxyAuthorized ? 'rpt-status-approved' : 'rpt-status-draft'}`}
                              >
                                {item.proxyAuthorized ? 'Đã ủy quyền' : 'Tự quyết toán'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-INS-01 Table (Báo cáo trích nộp BHXH/YT/TN) */}
                {activeReport.code === 'RPT-INS-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>Mã số BHXH</th>
                        <th>Lương đóng BHXH</th>
                        <th>Lương đóng BHTN</th>
                        <th>NLĐ (10.5%)</th>
                        <th>DN (21.5%)</th>
                        <th>Kinh phí CĐ (2%)</th>
                        <th>Tổng trích nộp (34%)</th>
                        <th>Chênh lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu trích nộp bảo hiểm trong kỳ này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.socialInsuranceCode || '—'}</td>
                            <td>{formatVND(item.salarySi)}</td>
                            <td>{formatVND(item.salaryUi)}</td>
                            <td style={{ color: '#dc2626' }}>
                              {formatVND(item.totalEmployeeShare)}
                            </td>
                            <td style={{ color: '#d97706' }}>
                              {formatVND(item.totalEmployerShare)}
                            </td>
                            <td>{formatVND(item.tradeUnionFee)}</td>
                            <td>
                              <strong style={{ color: '#2563eb' }}>
                                {formatVND(item.totalContribution)}
                              </strong>
                            </td>
                            <td>
                              {Number(item.variance) !== 0 ? (
                                <strong style={{ color: '#dc2626' }}>
                                  {formatVND(item.variance)}
                                </strong>
                              ) : (
                                <span style={{ color: '#16a34a' }}>0 ₫</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-INS-02 Table (Mẫu D02-LT Biến động lao động) */}
                {activeReport.code === 'RPT-INS-02' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>Chức danh</th>
                        <th>Mã số BHXH</th>
                        <th>Loại biến động</th>
                        <th>Ngày hiệu lực</th>
                        <th>Lương đóng BH mới</th>
                        <th>Loại HĐ</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có phát sinh biến động bảo hiểm trong khoảng thời gian này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.positionTitle || '—'}</td>
                            <td>{item.socialInsuranceCode || '—'}</td>
                            <td>
                              <span
                                className={`rpt-status-pill ${
                                  item.fluctuationType === 'INCREASE'
                                    ? 'rpt-status-approved'
                                    : item.fluctuationType === 'DECREASE'
                                      ? 'rpt-status-rejected'
                                      : 'rpt-status-partial'
                                }`}
                              >
                                {item.fluctuationType === 'INCREASE'
                                  ? 'Tăng LĐ'
                                  : item.fluctuationType === 'DECREASE'
                                    ? 'Giảm LĐ'
                                    : 'Điều chỉnh'}
                              </span>
                            </td>
                            <td>{item.effectiveDate}</td>
                            <td>
                              <strong>{formatVND(item.newSalarySi)}</strong>
                            </td>
                            <td>{item.contractType || '—'}</td>
                            <td>{item.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* RPT-LAB-01 Table (Mẫu 01/PLI Tình hình sử dụng lao động) */}
                {activeReport.code === 'RPT-LAB-01' && (
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Giới tính</th>
                        <th>Ngày sinh</th>
                        <th>Chức danh</th>
                        <th>Phòng ban</th>
                        <th>Loại HĐLĐ</th>
                        <th>Trình độ</th>
                        <th>Ngày bắt đầu</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                            Không có dữ liệu báo cáo sử dụng lao động trong kỳ này.
                          </td>
                        </tr>
                      ) : (
                        reportData?.items?.map((item) => (
                          <tr key={item.employeeCode}>
                            <td>
                              <strong>{item.employeeCode}</strong>
                            </td>
                            <td>{item.fullName}</td>
                            <td>{item.gender === 'FEMALE' ? 'Nữ' : 'Nam'}</td>
                            <td>{item.birthDate || '—'}</td>
                            <td>{item.positionTitle || '—'}</td>
                            <td>{item.departmentName}</td>
                            <td>
                              <span className="rpt-badge">{item.contractType}</span>
                            </td>
                            <td>{item.educationLevel || 'Đại học'}</td>
                            <td>{item.hireDate || item.contractStartDate || '—'}</td>
                            <td>
                              <span
                                className={`rpt-status-pill rpt-status-${(item.employmentStatus || 'active').toLowerCase()}`}
                              >
                                {item.employmentStatus}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {/* Pagination Controls */}
                {reportData?.pagination && (
                  <div className="rpt-pagination">
                    <span>
                      Hiển thị trang <strong>{reportData.pagination.page}</strong> /{' '}
                      <strong>{reportData.pagination.totalPages}</strong> (
                      {reportData.pagination.totalRows} kết quả)
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="secondary"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                      >
                        ← Trang trước
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={page >= reportData.pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                      >
                        Trang sau →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
