import { useState, useEffect, type FormEvent } from 'react';
import type { Profile } from './api';
import { request, errorText } from './api';
import './payroll.css';

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  type: 'BASE_SALARY' | 'ALLOWANCE' | 'BONUS' | 'DEDUCTION';
  calculationType: 'FIXED' | 'PERCENTAGE' | 'ATTENDANCE_BASED' | 'FORMULA';
  isTaxable: boolean;
  isStatutory: boolean;
  defaultAmount: number | string;
  active: boolean;
  description: string | null;
}

export interface PayrollPeriod {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  paymentDate: string | null;
  standardWorkingDays: number | string;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'CLOSED';
  slipCount?: number;
  notes: string | null;
}

export interface PayrollSlip {
  id: string;
  periodId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  departmentName: string | null;
  positionTitle: string | null;
  salaryMode: 'GROSS' | 'NET';
  standardDays: number | string;
  actualWorkingDays: number | string;
  paidLeaveDays: number | string;
  baseSalary: number | string;
  proratedBaseSalary: number | string;
  totalAllowances: number | string;
  totalBonuses: number | string;
  totalDeductions: number | string;
  grossPay: number | string;
  netPay: number | string;
  status: string;
  periodName?: string;
  periodCode?: string;
  periodStartDate?: string;
  periodEndDate?: string;
}

export interface PayrollSlipItem {
  id: string;
  componentName: string;
  type: string;
  amount: number | string;
  notes: string | null;
}

export interface PeriodSummary {
  totalSlips: number;
  totalGross: string;
  totalNet: string;
  totalEmployees: number;
}

// Accounting & Reconciliation (PAY-003)
export interface ReconciliationSummary {
  id: string;
  periodId: string;
  periodCode: string;
  periodName: string;
  reconciliationDate: string;
  status: 'RECONCILED' | 'DISCREPANCY_DETECTED' | 'RESOLVED';
  totalExpectedSlips: number;
  totalExpectedAmount: string;
  totalDisbursedSlips: number;
  totalDisbursedAmount: string;
  differenceAmount: string;
  matchedCount: number;
  discrepancyCount: number;
}

export interface ReconciliationDiscrepancy {
  id: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  discrepancyType: 'UNPAID' | 'UNDERPAID' | 'OVERPAID' | 'DUPLICATE' | 'ORPHAN_PAYMENT';
  expectedAmount: string;
  actualAmount: string;
  varianceAmount: string;
  resolutionStatus: 'PENDING' | 'RESOLVED' | 'IGNORED';
  notes: string | null;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  totalDebit: string;
  totalCredit: string;
  description: string;
  reversalEntryId?: string | null;
}

export interface JournalEntryLine {
  id: string;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
}

export interface PayrollLiability {
  id: string;
  periodId: string;
  periodCode: string;
  periodName: string;
  beginningBalance: string;
  incurredAmount: string;
  paidAmount: string;
  endingBalance: string;
  status: 'OPEN' | 'SETTLED' | 'PARTIALLY_SETTLED' | 'OVERDUE';
}

// Compliance & Reporting (PAY-004)
export interface StatutoryRule {
  id: string;
  ruleType: string;
  ruleCode: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  parameters: any;
  legalReference: string;
  isVerified: boolean;
  notes: string | null;
}

export interface PitSummary {
  totalEmployees: number;
  totalGrossPay: string;
  totalTaxableIncome: string;
  totalPersonalDeduction: string;
  totalDependentDeduction: string;
  totalInsuranceDeduction: string;
  totalAssessableIncome: string;
  totalCalculatedTax: string;
  totalWithheldTax: string;
  totalVariance: string;
}

export interface PitEmployeeItem {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  departmentName: string;
  grossPay: string;
  nonTaxableIncome: string;
  taxableIncome: string;
  personalDeduction: string;
  dependentCount: number;
  dependentDeduction: string;
  insuranceDeduction: string;
  assessableIncome: string;
  calculatedTax: string;
  withheldTax: string;
  variance: string;
}

export interface SiReportSummary {
  totalParticipants: number;
  totalSiSalaryFund: string;
  totalEmployeePortion: string;
  totalEmployerPortion: string;
  totalTradeUnion: string;
  totalPayableInsuranceAgency: string;
  totalCostToCompany: string;
}

export interface HrAnalyticsSummary {
  employeeCount: number;
  grossPayroll: string;
  proratedBaseSalary: string;
  allowances: string;
  bonuses: string;
  overtimePay: string;
  employerSocialInsurance: string;
  employerTradeUnion: string;
  totalCostToCompany: string;
  financialMetrics: {
    accruedExpense: string;
    payableLiability: string;
    disbursedPayment: string;
    remainingUnpaid: string;
  };
  momComparison: {
    previousGross: string;
    deltaAmount: string;
    percentChange: number;
  };
  departmentDistribution: Array<{
    departmentName: string;
    employeeCount: number;
    grossAmount: string;
    percentOfTotal: number;
  }>;
}

export interface ComplianceAnomaly {
  id: string;
  periodId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  anomalyCode: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  description: string;
  expectedValue: string;
  actualValue: string;
  resolutionStatus: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'WAIVED';
  resolutionNotes: string | null;
  resolvedAt: string | null;
}

export interface ComplianceReport {
  id: string;
  reportType: string;
  reportCode: string;
  title: string;
  periodId: string | null;
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'LOCKED';
  summaryData: any;
  anomalyCount: number;
  exportCount: number;
  lastExportedAt: string | null;
  createdAt: string;
  createdByName: string;
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Bản nháp',
  UNDER_REVIEW: 'Đang kiểm tra',
  APPROVED: 'Đã phê duyệt',
  CLOSED: 'Đã chốt & Khóa',
};

const typeLabels: Record<string, string> = {
  BASE_SALARY: 'Lương cơ bản',
  ALLOWANCE: 'Phụ cấp',
  BONUS: 'Thưởng',
  DEDUCTION: 'Khấu trừ',
};

export function formatVND(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '0 ₫';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
}

export function Payroll({
  profile,
  view = 'periods',
}: {
  profile: Profile;
  view?: 'periods' | 'components' | 'accounting' | 'compliance' | 'my-slips';
}) {
  const [activeTab, setActiveTab] = useState<'periods' | 'components' | 'accounting' | 'compliance' | 'my-slips'>(view);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isHR = ['ADMIN', 'HR'].includes(profile.organization.role);

  // Periods state
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);
  const [periodSlips, setPeriodSlips] = useState<PayrollSlip[]>([]);
  const [slipsSearch, setSlipsSearch] = useState('');
  const [showCreatePeriod, setShowCreatePeriod] = useState(false);

  // Components state
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [showCreateComponent, setShowCreateComponent] = useState(false);

  // My slips state
  const [mySlips, setMySlips] = useState<PayrollSlip[]>([]);

  // Selected slip detail modal
  const [selectedSlip, setSelectedSlip] = useState<PayrollSlip | null>(null);
  const [selectedSlipItems, setSelectedSlipItems] = useState<PayrollSlipItem[]>([]);

  // Accounting & Reconciliation state (PAY-003)
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null);
  const [discrepancies, setDiscrepancies] = useState<ReconciliationDiscrepancy[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [liability, setLiability] = useState<PayrollLiability | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ entry: JournalEntry; lines: JournalEntryLine[] } | null>(null);

  // Compliance & Reporting state (PAY-004)
  const [complianceSubTab, setComplianceSubTab] = useState<'pit' | 'insurance' | 'analytics' | 'anomalies' | 'reports' | 'rules'>('pit');
  const [statutoryRules, setStatutoryRules] = useState<StatutoryRule[]>([]);
  const [pitData, setPitData] = useState<{ summary: PitSummary; employees: PitEmployeeItem[] } | null>(null);
  const [siData, setSiData] = useState<{ summary: SiReportSummary; rates: any; employees: any[] } | null>(null);
  const [analyticsData, setAnalyticsData] = useState<HrAnalyticsSummary | null>(null);
  const [anomalies, setAnomalies] = useState<ComplianceAnomaly[]>([]);
  const [complianceReports, setComplianceReports] = useState<ComplianceReport[]>([]);

  const orgPath = `/api/organizations/${profile.organization.id}/payroll`;

  const loadPeriods = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ items: PayrollPeriod[] }>(`${orgPath}/periods`);
      setPeriods(res.items || []);
      if ((res.items || []).length > 0 && !selectedPeriod) {
        void selectPeriod(res.items[0]);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const selectPeriod = async (p: PayrollPeriod) => {
    setSelectedPeriod(p);
    try {
      setLoading(true);
      const [detailRes, slipsRes] = await Promise.all([
        request<{ period: PayrollPeriod; summary: PeriodSummary }>(`${orgPath}/periods/${p.id}`),
        request<{ items: PayrollSlip[] }>(`${orgPath}/periods/${p.id}/slips`),
      ]);
      setSelectedPeriod(detailRes.period);
      setPeriodSummary(detailRes.summary);
      setPeriodSlips(slipsRes.items || []);
      if (activeTab === 'accounting') {
        void loadAccountingData(p.id);
      } else if (activeTab === 'compliance') {
        void loadComplianceData(p.id);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const loadAccountingData = async (periodId: string) => {
    try {
      setLoading(true);
      setError(null);
      const [recRes, entriesRes, liabRes] = await Promise.all([
        request<{ reconciliation: ReconciliationSummary | null; discrepancies: ReconciliationDiscrepancy[] }>(
          `${orgPath}/periods/${periodId}/reconciliation`
        ).catch(() => ({ reconciliation: null, discrepancies: [] })),
        request<{ items: JournalEntry[] }>(
          `${orgPath}/periods/${periodId}/accounting/entries`
        ).catch(() => ({ items: [] })),
        request<{ liability: PayrollLiability }>(
          `${orgPath}/periods/${periodId}/liabilities`
        ).catch(() => ({ liability: null })),
      ]);
      setReconciliation(recRes.reconciliation);
      setDiscrepancies(recRes.discrepancies || []);
      setJournalEntries(entriesRes.items || []);
      setLiability(liabRes.liability);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const loadComplianceData = async (periodId: string) => {
    try {
      setLoading(true);
      setError(null);
      const [rulesRes, pitRes, siRes, analyticsRes, anomRes, repsRes] = await Promise.all([
        request<{ rules: StatutoryRule[] }>(`${orgPath}/compliance/rules`).catch(() => ({ rules: [] })),
        request<{ summary: PitSummary; employees: PitEmployeeItem[] }>(`${orgPath}/compliance/pit/period/${periodId}`).catch(() => null),
        request<{ summary: SiReportSummary; rates: any; employees: any[] }>(`${orgPath}/compliance/insurance/period/${periodId}`).catch(() => null),
        request<{ analytics: HrAnalyticsSummary }>(`${orgPath}/compliance/analytics/period/${periodId}`).catch(() => null),
        request<{ anomalies: ComplianceAnomaly[] }>(`${orgPath}/compliance/anomalies?periodId=${periodId}`).catch(() => ({ anomalies: [] })),
        request<{ reports: ComplianceReport[] }>(`${orgPath}/compliance/reports`).catch(() => ({ reports: [] })),
      ]);
      setStatutoryRules(rulesRes.rules || []);
      setPitData(pitRes);
      setSiData(siRes);
      setAnalyticsData(analyticsRes?.analytics || null);
      setAnomalies(anomRes.anomalies || []);
      setComplianceReports(repsRes.reports || []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const loadComponents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ items: SalaryComponent[] }>(`${orgPath}/components`);
      setComponents(res.items || []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const loadMySlips = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ items: PayrollSlip[] }>(`${orgPath}/my-slips`);
      setMySlips(res.items || []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'periods') {
      void loadPeriods();
    } else if (activeTab === 'components') {
      void loadComponents();
    } else if (activeTab === 'accounting') {
      if (periods.length === 0) {
        void loadPeriods();
      } else if (selectedPeriod) {
        void loadAccountingData(selectedPeriod.id);
      }
    } else if (activeTab === 'compliance') {
      if (periods.length === 0) {
        void loadPeriods();
      } else if (selectedPeriod) {
        void loadComplianceData(selectedPeriod.id);
      }
    } else if (activeTab === 'my-slips') {
      void loadMySlips();
    }
  }, [activeTab]);

  const handleCalculateDraft = async () => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ generatedSlips: number }>(`${orgPath}/periods/${selectedPeriod.id}/calculate`, {});
      setSuccess(`Đã tính toán xong bảng lương nháp cho ${res.generatedSlips} nhân viên.`);
      await selectPeriod(selectedPeriod);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (status: PayrollPeriod['status']) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ period: PayrollPeriod }>(`${orgPath}/periods/${selectedPeriod.id}/status`, { status }, 'PATCH');
      setSelectedPeriod(res.period);
      setSuccess(`Đã cập nhật trạng thái kỳ lương sang: ${statusLabels[status]}`);
      await loadPeriods();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  // Accounting Actions
  const handleReconcile = async () => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/periods/${selectedPeriod.id}/reconcile`, {}, 'POST');
      setSuccess('Đã thực hiện đối chiếu bảng lương và dữ liệu chi trả.');
      await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateJournal = async () => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/periods/${selectedPeriod.id}/accounting/generate?status=POSTED`, {}, 'POST');
      setSuccess('Đã tạo và ghi sổ bút toán kế toán thành công.');
      await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePostEntry = async (entryId: string) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/accounting/entries/${entryId}/post`, {}, 'POST');
      setSuccess('Đã ghi sổ chứng từ kế toán.');
      await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReverseEntry = async (entryId: string) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/accounting/entries/${entryId}/reverse`, {}, 'POST');
      setSuccess('Đã lập chứng từ đảo bút toán.');
      await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleViewEntry = async (entryId: string) => {
    try {
      setLoading(true);
      const res = await request<{ entry: JournalEntry; lines: JournalEntryLine[] }>(`${orgPath}/accounting/entries/${entryId}`);
      setSelectedEntry(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSeedAccountingDefaults = async () => {
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/accounting/accounts/seed-defaults`, {}, 'POST');
      setSuccess('Đã thiết lập hệ thống tài khoản và định khoản chuẩn VAS.');
      if (selectedPeriod) await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDiscrepancy = async (discId: string, status: 'RESOLVED' | 'INVESTIGATING' | 'IGNORED') => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/reconciliation/discrepancies/${discId}`, {
        resolutionStatus: status,
        resolutionNotes: `Đã xử lý trạng thái sang ${status}`,
      }, 'PATCH');
      setSuccess('Đã cập nhật trạng thái xử lý chênh lệch.');
      await loadAccountingData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExportAccounting = (type: 'journal' | 'reconciliation' | 'disbursements') => {
    if (!selectedPeriod) return;
    window.open(`${orgPath}/periods/${selectedPeriod.id}/accounting/export?type=${type}&format=csv`, '_blank');
  };

  // Compliance Actions (PAY-004)
  const handleSeedComplianceDefaults = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ seededCount: number }>(`${orgPath}/compliance/rules/seed-defaults`, {}, 'POST');
      setSuccess(`Đã nạp ${res.seededCount} quy tắc tuân thủ pháp luật Việt Nam.`);
      if (selectedPeriod) await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRunComplianceCheck = async () => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ count: number }>(`${orgPath}/compliance/check/${selectedPeriod.id}`, {}, 'POST');
      setSuccess(`Kiểm tra tuân thủ hoàn tất: phát hiện ${res.count} cảnh báo.`);
      await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAnomaly = async (id: string, status: 'RESOLVED' | 'ACKNOWLEDGED' | 'WAIVED') => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/compliance/anomalies/${id}/resolve`, {
        status,
        notes: 'Đã giải trình và xác nhận bởi người phụ trách',
      }, 'PATCH');
      setSuccess('Đã cập nhật trạng thái xử lý bất thường.');
      await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateComplianceReport = async (reportType: string, title: string) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/compliance/reports/generate`, {
        reportType,
        periodId: selectedPeriod.id,
        title,
        summaryData: reportType.startsWith('PIT') ? pitData?.summary : reportType.startsWith('SI') ? siData?.summary : analyticsData,
      }, 'POST');
      setSuccess('Đã lập báo cáo tuân thủ nháp thành công.');
      await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApproveReport = async (id: string) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/compliance/reports/${id}/approve`, {}, 'POST');
      setSuccess('Đã phê duyệt báo cáo tuân thủ.');
      await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLockReport = async (id: string) => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/compliance/reports/${id}/lock`, {}, 'POST');
      setSuccess('Đã khóa báo cáo tuân thủ vĩnh viễn (bất biến).');
      await loadComplianceData(selectedPeriod.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExportComplianceReport = (id: string) => {
    window.open(`${orgPath}/compliance/reports/${id}/export`, '_blank');
  };

  const handleCreatePeriod = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      setLoading(true);
      setError(null);
      const newPeriod = await request<PayrollPeriod>(`${orgPath}/periods`, {
        code: fd.get('code'),
        name: fd.get('name'),
        startDate: fd.get('startDate'),
        endDate: fd.get('endDate'),
        paymentDate: fd.get('paymentDate') || undefined,
        standardWorkingDays: Number(fd.get('standardWorkingDays')) || 22,
        notes: fd.get('notes') || undefined,
      });
      setShowCreatePeriod(false);
      setSuccess('Đã tạo kỳ lương mới.');
      await loadPeriods();
      await selectPeriod(newPeriod);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateComponent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      setLoading(true);
      setError(null);
      await request<SalaryComponent>(`${orgPath}/components`, {
        code: fd.get('code'),
        name: fd.get('name'),
        type: fd.get('type'),
        calculationType: fd.get('calculationType') || 'FIXED',
        isTaxable: fd.get('isTaxable') === 'on',
        isStatutory: fd.get('isStatutory') === 'on',
        defaultAmount: Number(fd.get('defaultAmount')) || 0,
        active: true,
        description: fd.get('description') || undefined,
      });
      setShowCreateComponent(false);
      setSuccess('Đã tạo cấu phần lương mới.');
      await loadComponents();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredSlips = (periodSlips || []).filter(s =>
    !slipsSearch ||
    s.fullName.toLowerCase().includes(slipsSearch.toLowerCase()) ||
    s.employeeCode.toLowerCase().includes(slipsSearch.toLowerCase())
  );

  return (
    <div className="payroll-container">
      <div className="payroll-header">
        <div>
          <h2>Quản lý Tiền lương & Bảng lương</h2>
          <p className="text-muted">Hệ thống tính lương, đối chiếu, hạch toán và kiểm soát tuân thủ pháp luật</p>
        </div>
      </div>

      <div className="payroll-tabs">
        <button
          type="button"
          className={`payroll-tab-button ${activeTab === 'periods' ? 'active' : ''}`}
          onClick={() => setActiveTab('periods')}
        >
          Kỳ lương & Bảng lương
        </button>
        {isHR && (
          <button
            type="button"
            className={`payroll-tab-button ${activeTab === 'components' ? 'active' : ''}`}
            onClick={() => setActiveTab('components')}
          >
            Cấu phần lương & Phụ cấp
          </button>
        )}
        {isHR && (
          <button
            type="button"
            className={`payroll-tab-button ${activeTab === 'accounting' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('accounting');
              if (selectedPeriod) void loadAccountingData(selectedPeriod.id);
            }}
          >
            Đối chiếu & Hạch toán
          </button>
        )}
        {isHR && (
          <button
            type="button"
            className={`payroll-tab-button ${activeTab === 'compliance' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('compliance');
              if (selectedPeriod) void loadComplianceData(selectedPeriod.id);
            }}
          >
            Tuân thủ & Báo cáo
          </button>
        )}
        <button
          type="button"
          className={`payroll-tab-button ${activeTab === 'my-slips' ? 'active' : ''}`}
          onClick={() => setActiveTab('my-slips')}
        >
          Phiếu lương của tôi
        </button>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {success && <div className="notice success" role="status">{success}</div>}

      {/* VIEW: PERIODS */}
      {activeTab === 'periods' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="payroll-toolbar">
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <label htmlFor="period-select" style={{ fontWeight: 600 }}>Kỳ lương:</label>
              <select
                id="period-select"
                value={selectedPeriod?.id || ''}
                onChange={e => {
                  const found = periods.find(p => p.id === e.target.value);
                  if (found) selectPeriod(found);
                }}
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) — {statusLabels[p.status]}
                  </option>
                ))}
              </select>
            </div>

            {isHR && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => setShowCreatePeriod(true)}
                >
                  + Mở kỳ lương mới
                </button>
              </div>
            )}
          </div>

          {selectedPeriod && (
            <>
              <div className="payroll-summary-cards">
                <div className="payroll-card">
                  <span className="payroll-card-label">Trạng thái kỳ</span>
                  <span className={`payroll-status-badge ${selectedPeriod.status}`}>
                    {statusLabels[selectedPeriod.status]}
                  </span>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Thời gian</span>
                  <strong className="payroll-card-value">
                    {selectedPeriod.startDate} ~ {selectedPeriod.endDate}
                  </strong>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Tổng quỹ lương Gross</span>
                  <strong className="payroll-card-value" style={{ color: '#2563eb' }}>
                    {formatVND(periodSummary?.totalGross)}
                  </strong>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Thực lĩnh chi trả Net</span>
                  <strong className="payroll-card-value" style={{ color: '#16a34a' }}>
                    {formatVND(periodSummary?.totalNet)}
                  </strong>
                </div>
              </div>

              {isHR && (
                <div className="payroll-actions-bar">
                  <span>Thao tác kỳ lương:</span>
                  {selectedPeriod.status !== 'CLOSED' && (
                    <button
                      type="button"
                      className="button-primary"
                      onClick={handleCalculateDraft}
                      disabled={loading}
                    >
                      ⚡ Tính toán bảng lương nháp
                    </button>
                  )}
                  {selectedPeriod.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleUpdateStatus('UNDER_REVIEW')}
                      disabled={loading}
                    >
                      Gửi kiểm tra (Review)
                    </button>
                  )}
                  {selectedPeriod.status === 'UNDER_REVIEW' && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleUpdateStatus('APPROVED')}
                      disabled={loading}
                    >
                      ✓ Phê duyệt bảng lương
                    </button>
                  )}
                  {selectedPeriod.status === 'APPROVED' && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleUpdateStatus('CLOSED')}
                      disabled={loading}
                    >
                      🔒 Chốt & Khóa kỳ lương vĩnh viễn
                    </button>
                  )}
                </div>
              )}

              {/* Slips table */}
              <div className="payroll-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Danh sách phiếu lương ({filteredSlips.length})</h3>
                  <input
                    type="search"
                    placeholder="Tìm theo tên hoặc mã NV..."
                    value={slipsSearch}
                    onChange={e => setSlipsSearch(e.target.value)}
                    style={{ maxWidth: 280 }}
                  />
                </div>

                <div className="payroll-table-container">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>Lương cơ bản</th>
                        <th>Ngày công</th>
                        <th>Lương thực tế</th>
                        <th>Phụ cấp</th>
                        <th>Thưởng</th>
                        <th>Khấu trừ</th>
                        <th>Gross</th>
                        <th>Thực lĩnh (Net)</th>
                        <th>Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSlips.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center text-muted">
                            Chưa có phiếu lương nào trong kỳ này. Nhấn "Tính toán bảng lương nháp" để bắt đầu.
                          </td>
                        </tr>
                      ) : (
                        filteredSlips.map(slip => (
                          <tr key={slip.id}>
                            <td><strong>{slip.employeeCode}</strong></td>
                            <td>{slip.fullName}</td>
                            <td>{slip.departmentName || '—'}</td>
                            <td>{formatVND(slip.baseSalary)}</td>
                            <td>{slip.actualWorkingDays} / {slip.standardDays}</td>
                            <td>{formatVND(slip.proratedBaseSalary)}</td>
                            <td>{formatVND(slip.totalAllowances)}</td>
                            <td>{formatVND(slip.totalBonuses)}</td>
                            <td style={{ color: '#ef4444' }}>-{formatVND(slip.totalDeductions)}</td>
                            <td><strong>{formatVND(slip.grossPay)}</strong></td>
                            <td style={{ color: '#16a34a', fontWeight: 'bold' }}>{formatVND(slip.netPay)}</td>
                            <td>
                              <button
                                type="button"
                                className="button-secondary"
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                onClick={async () => {
                                  setSelectedSlip(slip);
                                  const res = await request<{ items: PayrollSlipItem[] }>(`${orgPath}/slips/${slip.id}/items`);
                                  setSelectedSlipItems(res.items || []);
                                }}
                              >
                                Xem
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* VIEW: COMPONENTS */}
      {activeTab === 'components' && isHR && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="payroll-toolbar">
            <h3>Danh mục Cấu phần Lương & Phụ cấp</h3>
            <button
              type="button"
              className="button-primary"
              onClick={() => setShowCreateComponent(true)}
            >
              + Thêm cấu phần mới
            </button>
          </div>

          <div className="payroll-table-container">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên cấu phần</th>
                  <th>Phân loại</th>
                  <th>Cách tính</th>
                  <th>Số tiền mặc định</th>
                  <th>Tính thuế</th>
                  <th>Đóng BHXH</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {components.map(c => (
                  <tr key={c.id}>
                    <td><code>{c.code}</code></td>
                    <td><strong>{c.name}</strong></td>
                    <td>{typeLabels[c.type]}</td>
                    <td>{c.calculationType}</td>
                    <td>{formatVND(c.defaultAmount)}</td>
                    <td>{c.isTaxable ? '✓' : '—'}</td>
                    <td>{c.isStatutory ? '✓' : '—'}</td>
                    <td>
                      <span className={`badge ${c.active ? 'badge-success' : 'badge-disabled'}`}>
                        {c.active ? 'Đang dùng' : 'Ngưng dùng'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: MY SLIPS */}
      {activeTab === 'my-slips' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3>Phiếu lương cá nhân</h3>
          <div className="payroll-table-container">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Kỳ lương</th>
                  <th>Thời gian</th>
                  <th>Lương cơ bản</th>
                  <th>Ngày công thực tế</th>
                  <th>Lương thực nhận Gross</th>
                  <th>Các khoản trừ</th>
                  <th>THỰC LĨNH (NET)</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {mySlips.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted">Bạn chưa có phiếu lương nào được công bố.</td>
                  </tr>
                ) : (
                  mySlips.map(s => (
                    <tr key={s.id}>
                      <td><strong>{s.periodName || s.periodCode}</strong></td>
                      <td>{s.periodStartDate} ~ {s.periodEndDate}</td>
                      <td>{formatVND(s.baseSalary)}</td>
                      <td>{s.actualWorkingDays} ngày</td>
                      <td>{formatVND(s.grossPay)}</td>
                      <td style={{ color: '#ef4444' }}>-{formatVND(s.totalDeductions)}</td>
                      <td style={{ color: '#16a34a', fontWeight: 'bold' }}>{formatVND(s.netPay)}</td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={async () => {
                            const res = await request<{ slip?: PayrollSlip; items: PayrollSlipItem[] }>(`${orgPath}/slips/${s.id}`);
                            setSelectedSlip(res.slip || s);
                            setSelectedSlipItems(res.items || []);
                          }}
                        >
                          Xem chi tiết
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: ACCOUNTING (PAY-003) */}
      {activeTab === 'accounting' && isHR && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="payroll-toolbar">
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <label htmlFor="acc-period-select" style={{ fontWeight: 600 }}>Kỳ đối chiếu & hạch toán:</label>
              <select
                id="acc-period-select"
                value={selectedPeriod?.id || ''}
                onChange={e => {
                  const found = periods.find(p => p.id === e.target.value);
                  if (found) {
                    setSelectedPeriod(found);
                    void loadAccountingData(found.id);
                  }
                }}
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) — {statusLabels[p.status]}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button-secondary"
                onClick={handleSeedAccountingDefaults}
                disabled={loading}
              >
                ⚙ Thiết lập tài khoản VAS
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={handleReconcile}
                disabled={loading || !selectedPeriod}
              >
                🔍 Chạy đối chiếu
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={handleGenerateJournal}
                disabled={loading || !selectedPeriod}
              >
                📝 Tạo bút toán kế toán
              </button>
            </div>
          </div>

          {selectedPeriod && (
            <>
              {/* Reconciliation Summary Cards */}
              <div className="payroll-summary-cards">
                <div className="payroll-card">
                  <span className="payroll-card-label">Trạng thái đối chiếu</span>
                  <span className={`payroll-status-badge ${reconciliation?.status || 'PENDING'}`}>
                    {reconciliation?.status === 'RECONCILED' ? 'Khớp 100%' : reconciliation?.status === 'DISCREPANCY_DETECTED' ? 'Có sai lệch' : 'Chưa đối chiếu'}
                  </span>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Tổng thực lĩnh phải trả</span>
                  <strong className="payroll-card-value" style={{ color: '#2563eb' }}>
                    {formatVND(reconciliation?.totalExpectedAmount || liability?.incurredAmount || periodSummary?.totalNet)}
                  </strong>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Đã thanh toán (Disbursed)</span>
                  <strong className="payroll-card-value" style={{ color: '#16a34a' }}>
                    {formatVND(reconciliation?.totalDisbursedAmount || liability?.paidAmount || 0)}
                  </strong>
                </div>
                <div className="payroll-card">
                  <span className="payroll-card-label">Còn phải trả (Dư nợ)</span>
                  <strong className="payroll-card-value" style={{ color: '#ef4444' }}>
                    {formatVND(liability?.endingBalance || 0)}
                  </strong>
                </div>
              </div>

              {/* Discrepancies Table */}
              <div className="payroll-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Chi tiết sai lệch chi trả ({discrepancies.length})</h3>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleExportAccounting('reconciliation')}
                    >
                      📥 Xuất báo cáo đối chiếu CSV
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleExportAccounting('disbursements')}
                    >
                      📥 Xuất lệnh chi CSV
                    </button>
                  </div>
                </div>

                <div className="payroll-table-container">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Loại sai lệch</th>
                        <th>Số tiền phiếu lương</th>
                        <th>Số tiền thực chi</th>
                        <th>Chênh lệch</th>
                        <th>Trạng thái xử lý</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discrepancies.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center text-muted">
                            Không phát hiện sai lệch nào giữa bảng lương và danh sách chi trả.
                          </td>
                        </tr>
                      ) : (
                        discrepancies.map(d => (
                          <tr key={d.id}>
                            <td><strong>{d.employeeCode}</strong></td>
                            <td>{d.fullName}</td>
                            <td>
                              <span className={`badge ${d.discrepancyType === 'UNPAID' ? 'badge-danger' : 'badge-warning'}`}>
                                {d.discrepancyType}
                              </span>
                            </td>
                            <td>{formatVND(d.expectedAmount)}</td>
                            <td>{formatVND(d.actualAmount)}</td>
                            <td style={{ color: '#ef4444', fontWeight: 600 }}>{formatVND(d.varianceAmount)}</td>
                            <td>
                              <span className={`badge ${d.resolutionStatus === 'RESOLVED' ? 'badge-success' : 'badge-warning'}`}>
                                {d.resolutionStatus}
                              </span>
                            </td>
                            <td>
                              {d.resolutionStatus === 'PENDING' && (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => handleResolveDiscrepancy(d.id, 'RESOLVED')}
                                >
                                  Đánh dấu đã xử lý
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Journal Entries Ledger */}
              <div className="payroll-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Sổ nhật ký chứng từ kế toán ({journalEntries.length})</h3>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => handleExportAccounting('journal')}
                  >
                    📥 Xuất sổ nhật ký CSV
                  </button>
                </div>

                <div className="payroll-table-container">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th>Số chứng từ</th>
                        <th>Ngày hạch toán</th>
                        <th>Diễn giải</th>
                        <th>Tổng Nợ (Debit)</th>
                        <th>Tổng Có (Credit)</th>
                        <th>Cân đối</th>
                        <th>Trạng thái</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalEntries.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center text-muted">
                            Chưa có chứng từ kế toán nào cho kỳ này. Nhấn "Tạo bút toán kế toán" để sinh tự động.
                          </td>
                        </tr>
                      ) : (
                        journalEntries.map(entry => (
                          <tr key={entry.id}>
                            <td><code>{entry.entryNumber}</code></td>
                            <td>{entry.entryDate}</td>
                            <td>{entry.description}</td>
                            <td style={{ fontWeight: 600 }}>{formatVND(entry.totalDebit)}</td>
                            <td style={{ fontWeight: 600 }}>{formatVND(entry.totalCredit)}</td>
                            <td>
                              <span style={{ color: entry.totalDebit === entry.totalCredit ? '#16a34a' : '#ef4444' }}>
                                {entry.totalDebit === entry.totalCredit ? '✓ Cân đối' : '✗ Lệch'}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${entry.status === 'POSTED' ? 'badge-success' : entry.status === 'REVERSED' ? 'badge-dark' : 'badge-warning'}`}>
                                {entry.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => handleViewEntry(entry.id)}
                                >
                                  Xem
                                </button>
                                {entry.status === 'DRAFT' && (
                                  <button
                                    type="button"
                                    className="button-primary"
                                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                    onClick={() => handlePostEntry(entry.id)}
                                  >
                                    Ghi sổ
                                  </button>
                                )}
                                {entry.status === 'POSTED' && (
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                                    onClick={() => handleReverseEntry(entry.id)}
                                  >
                                    Đảo bút toán
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* VIEW: COMPLIANCE & REPORTING (PAY-004) */}
      {activeTab === 'compliance' && isHR && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="payroll-toolbar">
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="compliance-period-select" style={{ fontWeight: 600 }}>Kỳ báo cáo:</label>
              <select
                id="compliance-period-select"
                value={selectedPeriod?.id || ''}
                onChange={e => {
                  const found = periods.find(p => p.id === e.target.value);
                  if (found) {
                    setSelectedPeriod(found);
                    void loadComplianceData(found.id);
                  }
                }}
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) — {statusLabels[p.status]}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button-secondary"
                onClick={handleSeedComplianceDefaults}
                disabled={loading}
              >
                📜 Nạp quy tắc chuẩn VN
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={handleRunComplianceCheck}
                disabled={loading || !selectedPeriod}
              >
                🛡 Quét kiểm tra tuân thủ
              </button>
            </div>
          </div>

          {/* Compliance Sub-navigation */}
          <div className="payroll-tabs" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'pit' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('pit')}
            >
              Thuế TNCN
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'insurance' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('insurance')}
            >
              Bảo hiểm & KPCĐ
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('analytics')}
            >
              Phân tích chi phí CTC
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'anomalies' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('anomalies')}
            >
              Cảnh báo tuân thủ ({anomalies.filter(a => a.resolutionStatus === 'OPEN').length})
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'reports' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('reports')}
            >
              Báo cáo chính thức & Ký duyệt
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${complianceSubTab === 'rules' ? 'active' : ''}`}
              onClick={() => setComplianceSubTab('rules')}
            >
              Quy tắc pháp lý ({statutoryRules.length})
            </button>
          </div>

          {/* 1. PIT VIEW */}
          {complianceSubTab === 'pit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {pitData ? (
                <>
                  <div className="payroll-summary-cards">
                    <div className="payroll-card">
                      <span className="payroll-card-label">Tổng thu nhập Gross</span>
                      <strong className="payroll-card-value">{formatVND(pitData.summary.totalGrossPay)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Giảm trừ gia cảnh bản thân (11M)</span>
                      <strong className="payroll-card-value text-muted">{formatVND(pitData.summary.totalPersonalDeduction)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Giảm trừ người phụ thuộc (4.4M)</span>
                      <strong className="payroll-card-value text-muted">{formatVND(pitData.summary.totalDependentDeduction)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Thu nhập tính thuế TNCN</span>
                      <strong className="payroll-card-value" style={{ color: '#2563eb' }}>{formatVND(pitData.summary.totalAssessableIncome)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Thuế TNCN tính toán (Biểu lũy tiến)</span>
                      <strong className="payroll-card-value" style={{ color: '#d97706' }}>{formatVND(pitData.summary.totalCalculatedTax)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Thuế TNCN đã khấu trừ</span>
                      <strong className="payroll-card-value">{formatVND(pitData.summary.totalWithheldTax)}</strong>
                    </div>
                  </div>

                  <div className="payroll-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4>Bảng kê tính thuế TNCN chi tiết từng nhân viên</h4>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => handleGenerateComplianceReport('PIT_MONTHLY', `Báo cáo Thuế TNCN Tháng ${selectedPeriod?.code}`)}
                      >
                        📄 Lập báo cáo thuế chính thức
                      </button>
                    </div>
                    <div className="payroll-table-container">
                      <table className="payroll-table">
                        <thead>
                          <tr>
                            <th>Mã NV</th>
                            <th>Họ và tên</th>
                            <th>Phòng ban</th>
                            <th>Gross</th>
                            <th>Giảm trừ bản thân</th>
                            <th>NPT</th>
                            <th>Giảm trừ NPT</th>
                            <th>Thu nhập tính thuế</th>
                            <th>Thuế tính toán</th>
                            <th>Thuế đã khấu trừ</th>
                            <th>Chênh lệch</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pitData.employees.map(e => (
                            <tr key={e.employeeId}>
                              <td><strong>{e.employeeCode}</strong></td>
                              <td>{e.fullName}</td>
                              <td>{e.departmentName}</td>
                              <td>{formatVND(e.grossPay)}</td>
                              <td>{formatVND(e.personalDeduction)}</td>
                              <td>{e.dependentCount}</td>
                              <td>{formatVND(e.dependentDeduction)}</td>
                              <td style={{ fontWeight: 600 }}>{formatVND(e.assessableIncome)}</td>
                              <td style={{ color: '#d97706', fontWeight: 600 }}>{formatVND(e.calculatedTax)}</td>
                              <td>{formatVND(e.withheldTax)}</td>
                              <td style={{ color: parseFloat(e.variance) !== 0 ? '#ef4444' : '#16a34a' }}>
                                {formatVND(e.variance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-muted">Chưa có dữ liệu tính thuế cho kỳ này hoặc chưa tính bảng lương.</p>
              )}
            </div>
          )}

          {/* 2. INSURANCE VIEW */}
          {complianceSubTab === 'insurance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {siData ? (
                <>
                  <div className="payroll-summary-cards">
                    <div className="payroll-card">
                      <span className="payroll-card-label">Số người tham gia BHXH</span>
                      <strong className="payroll-card-value">{siData.summary.totalParticipants}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Quỹ lương đóng BHXH</span>
                      <strong className="payroll-card-value">{formatVND(siData.summary.totalSiSalaryFund)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">NLĐ đóng (BHXH 8%, BHYT 1.5%, BHTN 1%)</span>
                      <strong className="payroll-card-value" style={{ color: '#2563eb' }}>{formatVND(siData.summary.totalEmployeePortion)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">DN đóng (BHXH 17.5%, BHYT 3%, BHTN 1%)</span>
                      <strong className="payroll-card-value" style={{ color: '#7c3aed' }}>{formatVND(siData.summary.totalEmployerPortion)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Kinh phí công đoàn (2% DN nộp)</span>
                      <strong className="payroll-card-value">{formatVND(siData.summary.totalTradeUnion)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">Tổng phải nộp Cơ quan BHXH</span>
                      <strong className="payroll-card-value" style={{ color: '#dc2626' }}>{formatVND(siData.summary.totalPayableInsuranceAgency)}</strong>
                    </div>
                  </div>

                  <div className="payroll-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4>Bảng tổng hợp trích nộp bảo hiểm theo nhân viên</h4>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => handleGenerateComplianceReport('SI_MONTHLY', `Báo cáo BHXH Tháng ${selectedPeriod?.code}`)}
                      >
                        📄 Lập báo cáo bảo hiểm chính thức
                      </button>
                    </div>
                    <div className="payroll-table-container">
                      <table className="payroll-table">
                        <thead>
                          <tr>
                            <th>Mã NV</th>
                            <th>Họ và tên</th>
                            <th>Mã BHXH</th>
                            <th>Lương HĐ</th>
                            <th>Lương BHXH (Trần 46.8M)</th>
                            <th>NLĐ đóng (10.5%)</th>
                            <th>DN đóng (21.5%)</th>
                            <th>KPCĐ (2%)</th>
                            <th>Tổng trích nộp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {siData.employees.map((e: any) => (
                            <tr key={e.employeeId}>
                              <td><strong>{e.employeeCode}</strong></td>
                              <td>{e.fullName}</td>
                              <td>{e.siCode}</td>
                              <td>{formatVND(e.contractSiSalary)}</td>
                              <td>{formatVND(e.cappedBhxhSalary)}</td>
                              <td style={{ color: '#2563eb' }}>{formatVND(e.employeePortion.total)}</td>
                              <td style={{ color: '#7c3aed' }}>{formatVND(e.employerPortion.bhxh + e.employerPortion.bhyt + e.employerPortion.bhtn)}</td>
                              <td>{formatVND(e.employerPortion.tradeUnion)}</td>
                              <td><strong>{formatVND(e.totalPayable)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-muted">Chưa có dữ liệu bảo hiểm hoặc hồ sơ BHXH chưa được kích hoạt.</p>
              )}
            </div>
          )}

          {/* 3. HR COST ANALYTICS VIEW */}
          {complianceSubTab === 'analytics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {analyticsData ? (
                <>
                  <div className="payroll-summary-cards">
                    <div className="payroll-card">
                      <span className="payroll-card-label">Tổng chi phí nhân sự (Total CTC)</span>
                      <strong className="payroll-card-value" style={{ color: '#0f172a' }}>{formatVND(analyticsData.totalCostToCompany)}</strong>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">1. Chi phí ghi nhận (Accrued Expense)</span>
                      <strong className="payroll-card-value" style={{ color: '#2563eb' }}>{formatVND(analyticsData.financialMetrics.accruedExpense)}</strong>
                      <small className="text-muted">Nợ TK 6422/6421 (Gross + BH DN + KPCĐ)</small>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">2. Công nợ lương phải trả (Payable Liability)</span>
                      <strong className="payroll-card-value" style={{ color: '#d97706' }}>{formatVND(analyticsData.financialMetrics.payableLiability)}</strong>
                      <small className="text-muted">Có TK 3341 (Thực lĩnh NLĐ)</small>
                    </div>
                    <div className="payroll-card">
                      <span className="payroll-card-label">3. Thực tế đã chi trả (Disbursed Payment)</span>
                      <strong className="payroll-card-value" style={{ color: '#16a34a' }}>{formatVND(analyticsData.financialMetrics.disbursedPayment)}</strong>
                      <small className="text-muted">Có TK 1121/1111 (Ủy nhiệm chi)</small>
                    </div>
                  </div>

                  <div className="payroll-grid-two-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div className="payroll-section">
                      <h4>Cơ cấu chi phí theo cấu phần</h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                          <span>Lương cơ bản theo ngày công:</span>
                          <strong>{formatVND(analyticsData.proratedBaseSalary)}</strong>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                          <span>Tổng phụ cấp:</span>
                          <strong>{formatVND(analyticsData.allowances)}</strong>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                          <span>Tổng thưởng & khen thưởng:</span>
                          <strong>{formatVND(analyticsData.bonuses)}</strong>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                          <span>Lương làm thêm giờ (OT):</span>
                          <strong>{formatVND(analyticsData.overtimePay)}</strong>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                          <span>Bảo hiểm phần Doanh nghiệp đóng (21.5%):</span>
                          <strong style={{ color: '#7c3aed' }}>{formatVND(analyticsData.employerSocialInsurance)}</strong>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                          <span>Kinh phí công đoàn (2%):</span>
                          <strong>{formatVND(analyticsData.employerTradeUnion)}</strong>
                        </li>
                      </ul>
                    </div>

                    <div className="payroll-section">
                      <h4>Phân bổ chi phí theo phòng ban</h4>
                      <table className="payroll-table">
                        <thead>
                          <tr>
                            <th>Phòng ban</th>
                            <th>Số nhân sự</th>
                            <th>Chi phí Gross</th>
                            <th>Tỷ trọng (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsData.departmentDistribution.map(d => (
                            <tr key={d.departmentName}>
                              <td><strong>{d.departmentName}</strong></td>
                              <td>{d.employeeCount}</td>
                              <td>{formatVND(d.grossAmount)}</td>
                              <td>{d.percentOfTotal}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-muted">Chưa có dữ liệu phân tích chi phí cho kỳ này.</p>
              )}
            </div>
          )}

          {/* 4. COMPLIANCE ANOMALIES VIEW */}
          {complianceSubTab === 'anomalies' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4>Cảnh báo & Bất thường tuân thủ ({anomalies.length})</h4>
                <button
                  type="button"
                  className="button-primary"
                  onClick={handleRunComplianceCheck}
                  disabled={loading}
                >
                  ⚡ Chạy lại kiểm tra tự động
                </button>
              </div>

              {anomalies.length === 0 ? (
                <div className="notice success" style={{ margin: 0 }}>
                  ✓ Không phát hiện bất thường nào về mức lương tối thiểu, trần bảo hiểm, hay người phụ thuộc trong kỳ lương này.
                </div>
              ) : (
                <div className="payroll-table-container">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th>Mức độ</th>
                        <th>Loại cảnh báo</th>
                        <th>Nhân viên</th>
                        <th>Mô tả chi tiết</th>
                        <th>Giá trị thực tế / Chuẩn</th>
                        <th>Trạng thái</th>
                        <th>Thao tác giải trình</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map(a => (
                        <tr key={a.id}>
                          <td>
                            <span className={`badge ${a.severity === 'CRITICAL' ? 'badge-danger' : a.severity === 'WARNING' ? 'badge-warning' : 'badge-info'}`}>
                              {a.severity}
                            </span>
                          </td>
                          <td><code>{a.anomalyCode}</code></td>
                          <td>{a.fullName} ({a.employeeCode})</td>
                          <td>{a.description}</td>
                          <td>{a.actualValue} / <span className="text-muted">{a.expectedValue}</span></td>
                          <td>
                            <span className={`badge ${a.resolutionStatus === 'RESOLVED' ? 'badge-success' : 'badge-warning'}`}>
                              {a.resolutionStatus}
                            </span>
                          </td>
                          <td>
                            {a.resolutionStatus === 'OPEN' && (
                              <button
                                type="button"
                                className="button-secondary"
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                onClick={() => handleResolveAnomaly(a.id, 'RESOLVED')}
                              >
                                Xác nhận giải trình
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 5. FORMAL REPORTS LIFECYCLE VIEW */}
          {complianceSubTab === 'reports' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4>Danh sách Báo cáo Tuân thủ & Quyết toán Chính thức</h4>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => handleGenerateComplianceReport('PIT_MONTHLY', `Báo cáo thuế TNCN ${selectedPeriod?.code}`)}
                    disabled={!selectedPeriod}
                  >
                    + Lập báo cáo Thuế TNCN
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => handleGenerateComplianceReport('SI_MONTHLY', `Báo cáo BHXH ${selectedPeriod?.code}`)}
                    disabled={!selectedPeriod}
                  >
                    + Lập báo cáo Bảo hiểm
                  </button>
                </div>
              </div>

              <div className="payroll-table-container">
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th>Mã báo cáo</th>
                      <th>Tiêu đề</th>
                      <th>Loại</th>
                      <th>Kỳ báo cáo</th>
                      <th>Trạng thái ký duyệt</th>
                      <th>Người lập</th>
                      <th>Thao tác quy trình</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complianceReports.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted">Chưa có báo cáo tuân thủ chính thức nào được lập.</td>
                      </tr>
                    ) : (
                      complianceReports.map(r => (
                        <tr key={r.id}>
                          <td><strong>{r.reportCode}</strong></td>
                          <td>{r.title}</td>
                          <td><code>{r.reportType}</code></td>
                          <td>{r.periodStart} ~ {r.periodEnd}</td>
                          <td>
                            <span className={`badge ${r.status === 'LOCKED' ? 'badge-dark' : r.status === 'APPROVED' ? 'badge-success' : 'badge-warning'}`}>
                              {r.status}
                            </span>
                          </td>
                          <td>{r.createdByName}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {r.status === 'DRAFT' && (
                                <button
                                  type="button"
                                  className="button-primary"
                                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => handleApproveReport(r.id)}
                                >
                                  ✓ Phê duyệt
                                </button>
                              )}
                              {r.status === 'APPROVED' && profile.organization.role === 'ADMIN' && (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', background: '#334155', color: '#fff' }}
                                  onClick={() => handleLockReport(r.id)}
                                >
                                  🔒 Khóa vĩnh viễn
                                </button>
                              )}
                              {(r.status === 'APPROVED' || r.status === 'LOCKED') && (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => handleExportComplianceReport(r.id)}
                                >
                                  📥 Xuất CSV/Excel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. STATUTORY RULES VIEW */}
          {complianceSubTab === 'rules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4>Hệ thống Quy tắc Tuân thủ Pháp luật Việt Nam</h4>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleSeedComplianceDefaults}
                >
                  📜 Nạp lại quy tắc chuẩn mặc định
                </button>
              </div>

              <div className="payroll-table-container">
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th>Loại quy tắc</th>
                      <th>Mã</th>
                      <th>Tên quy tắc</th>
                      <th>Căn cứ pháp lý (Đã xác minh)</th>
                      <th>Ngày hiệu lực</th>
                      <th>Thông số áp dụng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statutoryRules.map(rule => (
                      <tr key={rule.id}>
                        <td><code>{rule.ruleType}</code></td>
                        <td><strong>{rule.ruleCode}</strong></td>
                        <td>{rule.name}</td>
                        <td style={{ color: '#0369a1', fontWeight: 600 }}>{rule.legalReference}</td>
                        <td>{rule.effectiveFrom} ~ {rule.effectiveTo || 'Hiện hành'}</td>
                        <td>
                          <pre style={{ margin: 0, fontSize: '0.75rem', maxHeight: 80, overflow: 'auto', background: '#f8fafc', padding: '0.25rem' }}>
                            {JSON.stringify(rule.parameters, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: JOURNAL ENTRY DETAIL */}
      {selectedEntry && (
        <dialog open className="dialog-modal" style={{ maxWidth: 750 }}>
          <div className="payroll-slip-detail-header">
            <div>
              <h3>Chứng từ kế toán: {selectedEntry.entry.entryNumber}</h3>
              <p className="text-muted">{selectedEntry.entry.description} | Ngày: {selectedEntry.entry.entryDate}</p>
            </div>
            <span className={`badge ${selectedEntry.entry.status === 'POSTED' ? 'badge-success' : 'badge-warning'}`}>
              {selectedEntry.entry.status}
            </span>
          </div>

          <div className="payroll-table-container" style={{ margin: '1rem 0' }}>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Mã TK</th>
                  <th>Tên tài khoản</th>
                  <th>Nợ (Debit)</th>
                  <th>Có (Credit)</th>
                  <th>Diễn giải</th>
                </tr>
              </thead>
              <tbody>
                {selectedEntry.lines.map(line => (
                  <tr key={line.id}>
                    <td><code>{line.accountCode}</code></td>
                    <td>{line.accountName}</td>
                    <td style={{ fontWeight: parseFloat(line.debitAmount) > 0 ? 600 : 400 }}>
                      {parseFloat(line.debitAmount) > 0 ? formatVND(line.debitAmount) : '—'}
                    </td>
                    <td style={{ fontWeight: parseFloat(line.creditAmount) > 0 ? 600 : 400 }}>
                      {parseFloat(line.creditAmount) > 0 ? formatVND(line.creditAmount) : '—'}
                    </td>
                    <td>{line.description}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 'bold' }}>
                  <td colSpan={2}>TỔNG CỘNG:</td>
                  <td style={{ color: '#2563eb' }}>{formatVND(selectedEntry.entry.totalDebit)}</td>
                  <td style={{ color: '#2563eb' }}>{formatVND(selectedEntry.entry.totalCredit)}</td>
                  <td>
                    {selectedEntry.entry.totalDebit === selectedEntry.entry.totalCredit ? '✓ Cân đối' : '✗ Lệch'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              type="button"
              className="button-primary"
              onClick={() => setSelectedEntry(null)}
            >
              Đóng
            </button>
          </div>
        </dialog>
      )}

      {/* MODAL: CREATE PERIOD */}
      {showCreatePeriod && (
        <dialog open className="dialog-modal">
          <h3>Mở kỳ lương mới</h3>
          <form onSubmit={handleCreatePeriod}>
            <div className="field">
              <label htmlFor="period-code">Mã kỳ (VD: KY-2026-02):</label>
              <input id="period-code" name="code" required />
            </div>
            <div className="field">
              <label htmlFor="period-name">Tên kỳ lương:</label>
              <input id="period-name" name="name" required placeholder="Kỳ lương Tháng 2/2026" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="period-start">Từ ngày:</label>
                <input id="period-start" name="startDate" type="date" required />
              </div>
              <div className="field">
                <label htmlFor="period-end">Đến ngày:</label>
                <input id="period-end" name="endDate" type="date" required />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="period-pay">Ngày chi trả dự kiến:</label>
                <input id="period-pay" name="paymentDate" type="date" />
              </div>
              <div className="field">
                <label htmlFor="period-std">Ngày công tiêu chuẩn:</label>
                <input id="period-std" name="standardWorkingDays" type="number" defaultValue={22} min={1} max={31} required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="period-notes">Ghi chú:</label>
              <textarea id="period-notes" name="notes" rows={2} />
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowCreatePeriod(false)}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="button-primary"
                disabled={loading}
              >
                Khởi tạo kỳ lương
              </button>
            </div>
          </form>
        </dialog>
      )}

      {/* MODAL: CREATE COMPONENT */}
      {showCreateComponent && (
        <dialog open className="dialog-modal">
          <h3>Thêm cấu phần lương mới</h3>
          <form onSubmit={handleCreateComponent}>
            <div className="field">
              <label htmlFor="comp-code">Mã cấu phần (VD: PHU_CAP_AN_TRUA):</label>
              <input id="comp-code" name="code" required />
            </div>
            <div className="field">
              <label htmlFor="comp-name">Tên cấu phần:</label>
              <input id="comp-name" name="name" required placeholder="Phụ cấp ăn trưa" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="comp-type">Phân loại:</label>
                <select id="comp-type" name="type" required>
                  <option value="ALLOWANCE">Phụ cấp</option>
                  <option value="BONUS">Thưởng</option>
                  <option value="DEDUCTION">Khấu trừ</option>
                  <option value="BASE_SALARY">Lương cơ bản</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="comp-calc">Cách tính:</label>
                <select id="comp-calc" name="calculationType" required>
                  <option value="FIXED">Cố định theo tháng</option>
                  <option value="ATTENDANCE_BASED">Theo ngày công</option>
                  <option value="PERCENTAGE">Theo tỷ lệ %</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="comp-amt">Số tiền mặc định (VND):</label>
              <input id="comp-amt" name="defaultAmount" type="number" defaultValue={0} min={0} required />
            </div>
            <div className="field-checkboxes" style={{ display: 'flex', gap: '1.5rem', margin: '0.75rem 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input name="isTaxable" type="checkbox" defaultChecked />
                Tính thuế TNCN
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input name="isStatutory" type="checkbox" />
                Đóng bảo hiểm bắt buộc
              </label>
            </div>
            <div className="field">
              <label htmlFor="comp-desc">Mô tả / Căn cứ:</label>
              <textarea id="comp-desc" name="description" rows={2} />
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowCreateComponent(false)}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="button-primary"
                disabled={loading}
              >
                Lưu cấu phần
              </button>
            </div>
          </form>
        </dialog>
      )}

      {/* MODAL: SLIP DETAIL */}
      {selectedSlip && (
        <dialog open className="dialog-modal" style={{ maxWidth: 650 }}>
          <div className="payroll-slip-detail-header">
            <div>
              <h3>Phiếu lương: {selectedSlip.fullName}</h3>
              <p className="text-muted">{selectedSlip.departmentName} — {selectedSlip.positionTitle}</p>
            </div>
            <span className="payroll-status-badge APPROVED">
              Chế độ: {selectedSlip.salaryMode}
            </span>
          </div>

          <div className="payroll-slip-breakdown">
            <h4>Chi tiết các khoản thu nhập & khấu trừ</h4>
            <div className="payroll-item-row header">
              <span>Khoản mục</span>
              <span>Số tiền</span>
            </div>

            <div className="payroll-item-row">
              <span>Lương cơ bản hợp đồng:</span>
              <span>{formatVND(selectedSlip.baseSalary)}</span>
            </div>
            <div className="payroll-item-row">
              <span>Lương thực tế (theo {selectedSlip.actualWorkingDays}/{selectedSlip.standardDays} ngày công):</span>
              <strong>{formatVND(selectedSlip.proratedBaseSalary)}</strong>
            </div>

            {selectedSlipItems.map(item => (
              <div key={item.id} className="payroll-item-row">
                <span>
                  {item.componentName}
                  {item.notes && <small style={{ display: 'block', color: '#64748b' }}>{item.notes}</small>}
                </span>
                <span style={{ color: item.type === 'DEDUCTION' ? '#ef4444' : '#0f172a' }}>
                  {item.type === 'DEDUCTION' ? '-' : '+'}{formatVND(item.amount)}
                </span>
              </div>
            ))}

            <div className="payroll-item-row" style={{ borderTop: '1px solid #cbd5e1', paddingTop: '0.5rem' }}>
              <span>Tổng thu nhập Gross:</span>
              <strong>{formatVND(selectedSlip.grossPay)}</strong>
            </div>
            <div className="payroll-item-row">
              <span>Tổng các khoản giảm trừ:</span>
              <strong style={{ color: '#ef4444' }}>-{formatVND(selectedSlip.totalDeductions)}</strong>
            </div>
            <div className="payroll-item-row total">
              <span>THỰC LĨNH (NET):</span>
              <span style={{ color: '#16a34a' }}>{formatVND(selectedSlip.netPay)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.5rem' }}>
            <button
              type="button"
              className="button-secondary"
              onClick={() => window.print()}
            >
              🖨 In phiếu lương
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={() => setSelectedSlip(null)}
            >
              Đã hiểu
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
