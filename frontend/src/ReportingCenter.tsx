import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ApiError, errorText, request, type Department, type Profile } from './api';
import './reporting.css';

export interface ReportItem {
  id?: string;
  code: string;
  category: 'EMPLOYEE' | 'ORGANIZATION' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'ACCOUNTING' | 'COMPLIANCE' | 'OTHER';
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
  filters: any;
  exportedBy: string;
  userName: string;
  userEmail: string;
  exportedAt: string;
}

export interface SavedTemplate {
  id: string;
  reportCode: string;
  templateName: string;
  filters: any;
  createdAt: string;
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

export function ReportingCenter({ profile, onNavigate, initialReportCode }: Props) {
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
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const defaultEnd = now.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(defaultStart);
  const [endDate, setEndDate] = useState<string>(defaultEnd);

  // Payroll & Accounting filters
  const [payrollPeriods, setPayrollPeriods] = useState<Array<{ id: string; code: string; name: string; status: string }>>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [comparePeriodId, setComparePeriodId] = useState<string>('');
  const [filterSettlementStatus, setFilterSettlementStatus] = useState<string>('');

  // Data & Execution State
  const [reportData, setReportData] = useState<any>(null);
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
          request<{ departments: Department[] }>(`/api/organizations/${orgId}/departments`).catch(() => ({ departments: [] }))
        ]);

        setReports(catRes.reports);
        setDepartments(deptRes.departments || []);

        if (initialReportCode) {
          const match = catRes.reports.find(r => r.code === initialReportCode);
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
        const res = await request<{ periods: Array<{ id: string; code: string; name: string; status: string }> }>(
          `/api/organizations/${orgId}/payroll/periods`
        );
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
        }

        if (endpoint) {
          const res = await request<any>(`${endpoint}?${queryParams.toString()}`);
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
    return () => { cancelled = true; };
  }, [activeReport, orgId, page, pageSize, filterDept, filterStatus, filterContractType, filterSearch, startDate, endDate, selectedPeriodId, comparePeriodId, filterSettlementStatus]);

  // Load audit logs if AUDIT tab selected
  useEffect(() => {
    if (selectedCategory === 'AUDIT' && isPrivileged) {
      void request<{ auditLogs: ExportAuditLog[] }>(`/api/organizations/${orgId}/reports/export-audit`)
        .then(res => setAuditLogs(res.auditLogs))
        .catch(err => setError(errorText(err)));
    }
  }, [selectedCategory, orgId, isPrivileged]);

  // Load saved templates for active report
  useEffect(() => {
    if (activeReport) {
      void request<{ templates: SavedTemplate[] }>(`/api/organizations/${orgId}/reports/templates`)
        .then(res => {
          setSavedTemplates(res.templates.filter(t => t.reportCode === activeReport.code));
        })
        .catch(() => {});
    }
  }, [activeReport, orgId]);

  // Preset Date range selection
  function handleDatePreset(preset: string) {
    const today = new Date();
    if (preset === 'THIS_MONTH') {
      setStartDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10));
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
      const filters: Record<string, any> = {};
      if (filterDept) filters.departmentId = filterDept;
      if (filterStatus) filters.status = filterStatus;
      if (filterContractType) filters.contractType = filterContractType;
      if (activeReport.code === 'RPT-ATT-01' || activeReport.code === 'RPT-LEAVE-01') {
        filters.startDate = startDate;
        filters.endDate = endDate;
      }
      if (selectedPeriodId) filters.periodId = selectedPeriodId;
      if (comparePeriodId && activeReport.code === 'RPT-PAY-03') filters.comparePeriodId = comparePeriodId;
      if (filterSettlementStatus && activeReport.code === 'RPT-ACC-02') filters.settlementStatus = filterSettlementStatus;

      const response = await fetch(`/api/organizations/${orgId}/reports/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          reportCode: activeReport.code,
          format: 'CSV',
          filters
        })
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
        settlementStatus: filterSettlementStatus
      };

      await request(`/api/organizations/${orgId}/reports/templates`, {
        reportCode: activeReport.code,
        templateName: templateNameInput.trim(),
        filters
      });

      setShowSaveTemplateModal(false);
      setTemplateNameInput('');
      setNotice('Đã lưu mẫu cấu hình bộ lọc thành công!');

      // Reload templates
      const res = await request<{ templates: SavedTemplate[] }>(`/api/organizations/${orgId}/reports/templates`);
      setSavedTemplates(res.templates.filter(t => t.reportCode === activeReport.code));
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
    if (tpl.filters.settlementStatus !== undefined) setFilterSettlementStatus(tpl.filters.settlementStatus);
    setNotice(`Đã áp dụng mẫu bộ lọc: ${tpl.templateName}`);
  }

  const filteredReports = reports.filter(r => {
    if (selectedCategory === 'ALL') return true;
    return r.category === selectedCategory;
  });

  return (
    <div className="rpt-container">
      {/* Header */}
      <div className="rpt-header">
        <div>
          <h1>Trung tâm báo cáo & Thống kê nhân sự</h1>
          <p>Báo cáo nhân sự, cơ cấu tổ chức, chấm công, ca làm việc, tiền lương và kế toán công nợ.</p>
        </div>
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
              ← Danh mục báo cáo
            </button>
            <button
              type="button"
              className="primary"
              disabled={exporting || loading}
              onClick={handleExportCsv}
            >
              {exporting ? 'Đang xuất CSV...' : 'Xuất dữ liệu CSV (Excel)'}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="notice success" role="status">
          {notice}
          <button type="button" style={{ float: 'right' }} onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button type="button" style={{ float: 'right' }} onClick={() => setError(null)}>×</button>
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
              Tất cả báo cáo
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'EMPLOYEE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('EMPLOYEE')}
            >
              Nhân sự (EMP)
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ORGANIZATION' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ORGANIZATION')}
            >
              Cơ cấu tổ chức (ORG)
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ATTENDANCE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ATTENDANCE')}
            >
              Chấm công & Ca (ATT)
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'LEAVE' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('LEAVE')}
            >
              Nghỉ phép (LEAVE)
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'PAYROLL' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('PAYROLL')}
            >
              Tiền lương (PAY)
            </button>
            <button
              type="button"
              className={`rpt-tab-btn ${selectedCategory === 'ACCOUNTING' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('ACCOUNTING')}
            >
              Hạch toán & Công nợ (ACC)
            </button>
            {isPrivileged && (
              <button
                type="button"
                className={`rpt-tab-btn ${selectedCategory === 'AUDIT' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('AUDIT')}
              >
                Nhật ký xuất báo cáo
              </button>
            )}
          </div>

          {/* Audit Logs Tab Content */}
          {selectedCategory === 'AUDIT' ? (
            <div className="rpt-table-container">
              <table className="rpt-table">
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th>Mã báo cáo</th>
                    <th>Người xuất</th>
                    <th>Email</th>
                    <th>Định dạng</th>
                    <th>Số dòng dữ liệu</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                        Chưa có lịch sử xuất báo cáo nào được ghi nhận.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map(log => (
                      <tr key={log.id}>
                        <td>{new Date(log.exportedAt).toLocaleString('vi-VN')}</td>
                        <td><strong>{log.reportCode}</strong></td>
                        <td>{log.userName}</td>
                        <td>{log.userEmail}</td>
                        <td><span className="rpt-badge">{log.format}</span></td>
                        <td>{log.rowCount} dòng</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Catalog Grid */
            <div className="rpt-catalog-grid">
              {filteredReports.map(item => (
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
                      <span className={`rpt-badge ${item.category.toLowerCase()}`}>{item.code}</span>
                      <span className="rpt-role-badge">Tối thiểu: {item.minRole}</span>
                    </div>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                  </div>
                  <div className="rpt-card-action">
                    <button type="button" className="secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div>
              <span className={`rpt-badge ${activeReport.category.toLowerCase()}`}>{activeReport.code}</span>
              <strong style={{ marginLeft: '0.75rem', fontSize: '1.1rem' }}>{activeReport.name}</strong>
            </div>
            {savedTemplates.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Mẫu đã lưu:</span>
                <select
                  onChange={e => {
                    const tpl = savedTemplates.find(t => t.id === e.target.value);
                    if (tpl) applySavedTemplate(tpl);
                  }}
                  defaultValue=""
                  style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                >
                  <option value="" disabled>Chọn mẫu bộ lọc...</option>
                  {savedTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.templateName}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Filter Bar */}
          <div className="rpt-filter-bar">
            {/* Date range filters if supported */}
            {(activeReport.code === 'RPT-ATT-01' || activeReport.code === 'RPT-LEAVE-01') && (
              <>
                <div className="rpt-filter-group">
                  <label>Kỳ thời gian</label>
                  <select onChange={e => handleDatePreset(e.target.value)} defaultValue="THIS_MONTH">
                    <option value="THIS_MONTH">Tháng này</option>
                    <option value="LAST_MONTH">Tháng trước</option>
                    <option value="THIS_YEAR">Năm nay</option>
                    <option value="CUSTOM">Tùy chọn</option>
                  </select>
                </div>
                <div className="rpt-filter-group">
                  <label>Từ ngày</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="rpt-filter-group">
                  <label>Đến ngày</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            {/* Period Filter for Payroll & Accounting */}
            {activeReport.supportedFilters.includes('periodId') && (
              <div className="rpt-filter-group">
                <label>Kỳ lương</label>
                <select value={selectedPeriodId} onChange={e => { setSelectedPeriodId(e.target.value); setPage(1); }}>
                  {payrollPeriods.length === 0 ? (
                    <option value="">(Chưa có kỳ lương)</option>
                  ) : (
                    payrollPeriods.map(p => (
                      <option key={p.id} value={p.id}>{p.code} - {p.name} ({p.status})</option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* Compare Period for RPT-PAY-03 */}
            {activeReport.code === 'RPT-PAY-03' && (
              <div className="rpt-filter-group">
                <label>Kỳ đối chiếu</label>
                <select value={comparePeriodId} onChange={e => { setComparePeriodId(e.target.value); setPage(1); }}>
                  <option value="">Kỳ liền kề trước (Mặc định)</option>
                  {payrollPeriods.filter(p => p.id !== selectedPeriodId).map(p => (
                    <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Department Filter */}
            {activeReport.supportedFilters.includes('departmentId') && (
              <div className="rpt-filter-group">
                <label>Phòng ban</label>
                <select value={filterDept} onChange={e => { setFilterDept(e.target.value); setPage(1); }}>
                  <option value="">Tất cả phòng ban</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Status Filter for EMP or ATT */}
            {activeReport.code === 'RPT-EMP-01' && (
              <div className="rpt-filter-group">
                <label>Trạng thái</label>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
                  <option value="">Tất cả trạng thái</option>
                  <option value="ACTIVE">Đang làm việc</option>
                  <option value="ON_LEAVE">Nghỉ phép</option>
                  <option value="TERMINATED">Đã nghỉ việc</option>
                </select>
              </div>
            )}

            {activeReport.code === 'RPT-ATT-01' && (
              <div className="rpt-filter-group">
                <label>Chuyên cần</label>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
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
                <select value={filterSettlementStatus} onChange={e => { setFilterSettlementStatus(e.target.value); setPage(1); }}>
                  <option value="">Tất cả trạng thái</option>
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
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
                  <option value="">Tất cả trạng thái</option>
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
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
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
                <select value={filterContractType} onChange={e => { setFilterContractType(e.target.value); setPage(1); }}>
                  <option value="">Tất cả loại HĐ</option>
                  <option value="INDEFINITE">Không xác định thời hạn</option>
                  <option value="FIXED_TERM">Xác định thời hạn</option>
                  <option value="PROBATION">Thử việc</option>
                </select>
              </div>
            )}

            {/* Keyword Search */}
            {activeReport.supportedFilters.includes('search') && (
              <div className="rpt-filter-group" style={{ flex: '1 1 200px' }}>
                <label>Tìm kiếm</label>
                <input
                  type="text"
                  placeholder="Mã NV, Họ tên..."
                  value={filterSearch}
                  onChange={e => { setFilterSearch(e.target.value); setPage(1); }}
                />
              </div>
            )}

            <div className="rpt-filter-actions">
              <button
                type="button"
                className="secondary"
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
                onClick={() => setShowSaveTemplateModal(true)}
              >
                ★ Lưu bộ lọc
              </button>
            </div>
          </div>

          {/* Modal: Save Template */}
          {showSaveTemplateModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', maxWidth: '400px', width: '100%', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
                <h3 style={{ margin: '0 0 1rem 0' }}>Lưu mẫu cấu hình bộ lọc</h3>
                <form onSubmit={handleSaveTemplate}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569' }}>
                    Tên mẫu cấu hình:
                    <input
                      type="text"
                      required
                      value={templateNameInput}
                      onChange={e => setTemplateNameInput(e.target.value)}
                      placeholder="VD: Báo cáo lương tháng này"
                      style={{ width: '100%', marginTop: '0.3rem', padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
                    <button type="button" className="secondary" onClick={() => setShowSaveTemplateModal(false)}>Hủy</button>
                    <button type="submit" className="primary">Lưu mẫu</button>
                  </div>
                </form>
              </div>
            </div>
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
                    <div className="rpt-kpi-title">Đang làm việc</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{reportData.metrics.activeEmployees}</div>
                    <div className="rpt-kpi-sub">Trạng thái ACTIVE</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đã nghỉ việc</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>{reportData.metrics.terminatedEmployees}</div>
                    <div className="rpt-kpi-sub">Trạng thái TERMINATED</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Thâm niên trung bình</div>
                    <div className="rpt-kpi-value">{reportData.metrics.averageTenureMonths} <span style={{ fontSize: '0.9rem' }}>tháng</span></div>
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
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{reportData.metrics.totalAssignedEmployees}</div>
                    <div className="rpt-kpi-sub">Nhân viên trực thuộc</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Có trưởng phòng</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{reportData.metrics.departmentsWithManager} / {reportData.metrics.totalDepartments}</div>
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
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{reportData.metrics.onTimeCount}</div>
                    <div className="rpt-kpi-sub">Trong giới hạn ân hạn</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đi muộn / Về sớm</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>{reportData.metrics.lateCount} / {reportData.metrics.earlyLeaveCount}</div>
                    <div className="rpt-kpi-sub">{reportData.metrics.totalLateMinutes}p muộn, {reportData.metrics.totalEarlyMinutes}p sớm</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ chuyên cần</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{reportData.metrics.attendanceRate}%</div>
                    <div className="rpt-kpi-sub">Hiện diện trên tổng ca</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-LEAVE-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng hạn mức phép</div>
                    <div className="rpt-kpi-value">{reportData.metrics.totalAllowanceDays} <span style={{ fontSize: '0.9rem' }}>ngày</span></div>
                    <div className="rpt-kpi-sub">Phép cấp trong năm</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phép đã sử dụng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{reportData.metrics.totalChargedDays} <span style={{ fontSize: '0.9rem' }}>ngày</span></div>
                    <div className="rpt-kpi-sub">Đơn phép đã duyệt</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Số dư phép còn lại</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{reportData.metrics.totalRemainingDays} <span style={{ fontSize: '0.9rem' }}>ngày</span></div>
                    <div className="rpt-kpi-sub">Hạn mức khả dụng</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ sử dụng phép</div>
                    <div className="rpt-kpi-value">{reportData.metrics.overallUtilizationRate}%</div>
                    <div className="rpt-kpi-sub">{reportData.metrics.approvedRequests} đơn đã duyệt</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng thực lĩnh (Net)</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{formatVND(reportData.metrics.totalNetPay)}</div>
                    <div className="rpt-kpi-sub">{reportData.metrics.slipCount} phiếu lương</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng lương Gross</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalGrossPay)}</div>
                    <div className="rpt-kpi-sub">Lương gộp trước khấu trừ</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng khấu trừ</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>{formatVND(reportData.metrics.totalDeductions)}</div>
                    <div className="rpt-kpi-sub">Bảo hiểm & Thuế TNCN</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp & Thưởng</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{formatVND(reportData.metrics.totalAllowances)}</div>
                    <div className="rpt-kpi-sub">Thưởng: {formatVND(reportData.metrics.totalBonuses)}</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp miễn thuế</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{formatVND(reportData.metrics.totalNonTaxableAllowances)}</div>
                    <div className="rpt-kpi-sub">Ăn ca, điện thoại, trang phục...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Phụ cấp tính thuế</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalTaxableAllowances)}</div>
                    <div className="rpt-kpi-sub">Chức vụ, trách nhiệm...</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Khấu trừ bảo hiểm NLĐ (10.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#dc2626' }}>{formatVND(reportData.metrics.totalStatutoryDeductions)}</div>
                    <div className="rpt-kpi-sub">BHXH 8%, BHYT 1.5%, BHTN 1%</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Thuế TNCN khấu trừ</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>{formatVND(reportData.metrics.totalPitDeductions)}</div>
                    <div className="rpt-kpi-sub">Thưởng: {formatVND(reportData.metrics.totalBonuses)}</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-PAY-03' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Biến động quỹ lương Net</div>
                    <div className="rpt-kpi-value" style={{ color: reportData.metrics.netPayVariancePct >= 0 ? '#dc2626' : '#16a34a' }}>
                      {reportData.metrics.netPayVariancePct >= 0 ? '+' : ''}{reportData.metrics.netPayVariancePct}%
                    </div>
                    <div className="rpt-kpi-sub">Chênh lệch: {formatVND(reportData.metrics.netPayDelta)}</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Biến động nhân sự</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.headcountDelta >= 0 ? '+' : ''}{reportData.metrics.headcountDelta} <span style={{ fontSize: '0.9rem' }}>người</span>
                    </div>
                    <div className="rpt-kpi-sub">So với kỳ trước</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Bình quân chênh lệch/NV</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.avgPayDeltaPerEmployee)}</div>
                    <div className="rpt-kpi-sub">Mức tăng/giảm TB</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Cảnh báo biến động &ge;20%</div>
                    <div className="rpt-kpi-value" style={{ color: reportData.metrics.anomalousCount > 0 ? '#d97706' : '#16a34a' }}>
                      {reportData.metrics.anomalousCount} <span style={{ fontSize: '0.9rem' }}>nhân sự</span>
                    </div>
                    <div className="rpt-kpi-sub">Cần rà soát biến động lớn</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ACC-01' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tổng chi phí nhân sự (CTC)</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{formatVND(reportData.metrics.totalCostToCompany)}</div>
                    <div className="rpt-kpi-sub">{reportData.metrics.departmentCount} phòng ban</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Lương Gross ghi nhận</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalGrossPay)}</div>
                    <div className="rpt-kpi-sub">Chi phí lương nhân viên</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">BHXH/YT/TN Doanh nghiệp (21.5%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#d97706' }}>{formatVND(reportData.metrics.totalEmployerSocialInsurance)}</div>
                    <div className="rpt-kpi-sub">Khoản bắt buộc người SDLĐ</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Kinh phí công đoàn (2%)</div>
                    <div className="rpt-kpi-value" style={{ color: '#64748b' }}>{formatVND(reportData.metrics.totalTradeUnionFee)}</div>
                    <div className="rpt-kpi-sub">Đóng theo quy định</div>
                  </div>
                </>
              )}

              {activeReport.code === 'RPT-ACC-02' && (
                <>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Lương phải trả (TK 3341)</div>
                    <div className="rpt-kpi-value">{formatVND(reportData.metrics.totalNetPayable)}</div>
                    <div className="rpt-kpi-sub">Tổng nghĩa vụ chi trả</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Đã chi trả thực tế</div>
                    <div className="rpt-kpi-value" style={{ color: '#16a34a' }}>{formatVND(reportData.metrics.totalDisbursed)}</div>
                    <div className="rpt-kpi-sub">TK 1121 / 1111</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Còn phải trả (Dư Có TK 3341)</div>
                    <div className="rpt-kpi-value" style={{ color: reportData.metrics.totalRemainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                      {formatVND(reportData.metrics.totalRemainingBalance)}
                    </div>
                    <div className="rpt-kpi-sub">Chưa thanh toán hoàn tất</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Tỷ lệ thanh toán</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>{reportData.metrics.settlementRate}%</div>
                    <div className="rpt-kpi-sub">{reportData.metrics.settledSlipsCount} đã trả / {reportData.metrics.unsettledSlipsCount} chưa trả</div>
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
                    <div className="rpt-kpi-value" style={{ color: reportData.metrics.isBalanced ? '#16a34a' : '#dc2626' }}>
                      {reportData.metrics.isBalanced ? '✓ CÂN ĐỐI' : '⚠ LỆCH'}
                    </div>
                    <div className="rpt-kpi-sub">Chênh lệch: {formatVND(reportData.metrics.balanceDelta)}</div>
                  </div>
                  <div className="rpt-kpi-card">
                    <div className="rpt-kpi-title">Bút toán đã ghi sổ</div>
                    <div className="rpt-kpi-value" style={{ color: '#2563eb' }}>
                      {reportData.metrics.postedEntriesCount} / {reportData.metrics.totalEntriesCount}
                    </div>
                    <div className="rpt-kpi-sub">Trạng thái POSTED</div>
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
                        <th>Phòng ban</th>
                        <th>Chức danh</th>
                        <th>Trạng thái</th>
                        <th>Hợp đồng</th>
                        <th>Ngày vào làm</th>
                        <th>Thâm niên</th>
                        <th>Số điện thoại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu nhân sự phù hợp.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.id}>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.positionTitle}</td>
                            <td><span className={`rpt-status-pill rpt-status-${item.employmentStatus.toLowerCase()}`}>{item.employmentStatus}</span></td>
                            <td>{item.contractType} ({item.contractNumber})</td>
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
                        <th>Trạng thái</th>
                        <th>Nhân sự</th>
                        <th>Vị trí chức danh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu phòng ban.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.id}>
                            <td><strong>{item.code}</strong></td>
                            <td>{item.name}</td>
                            <td>{item.parentName}</td>
                            <td>{item.managerName}</td>
                            <td><span className={`rpt-status-pill ${item.isActive ? 'rpt-status-active' : 'rpt-status-terminated'}`}>{item.isActive ? 'Hoạt động' : 'Tạm dừng'}</span></td>
                            <td><strong>{item.employeeCount}</strong> nhân viên</td>
                            <td>
                              <span style={{ fontSize: '0.8rem', color: '#475569' }}>{item.positionCount} vị trí: </span>
                              {item.positions?.map((p: any) => p.title).join(', ') || 'Chưa cấu hình'}
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
                        <th>Phòng ban</th>
                        <th>Ca làm việc</th>
                        <th>Giờ vào</th>
                        <th>Giờ ra</th>
                        <th>Trạng thái</th>
                        <th>Muộn/Sớm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu chấm công trong khoảng thời gian này.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.scheduleId}>
                            <td>{item.workDate}</td>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.shiftName}</td>
                            <td>{item.checkedInAt ? new Date(item.checkedInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td>{item.checkedOutAt ? new Date(item.checkedOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td><span className={`rpt-status-pill rpt-status-${item.status.toLowerCase()}`}>{item.status}</span></td>
                            <td>{item.lateMinutes > 0 ? `+${item.lateMinutes}p muộn` : ''} {item.earlyMinutes > 0 ? `-${item.earlyMinutes}p sớm` : ''} {!item.lateMinutes && !item.earlyMinutes ? '—' : ''}</td>
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
                        <th>Phòng ban</th>
                        <th>Loại nghỉ phép</th>
                        <th>Hạn mức (ngày)</th>
                        <th>Đã nghỉ (ngày)</th>
                        <th>Còn lại (ngày)</th>
                        <th>Tỷ lệ sử dụng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.balances?.length === 0 ? (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu số dư phép.</td></tr>
                      ) : (
                        reportData?.balances?.map((b: any, idx: number) => (
                          <tr key={`${b.employeeId}-${b.leaveTypeId}-${idx}`}>
                            <td><strong>{b.employeeCode}</strong></td>
                            <td>{b.fullName}</td>
                            <td>{b.departmentName}</td>
                            <td>{b.leaveTypeName}</td>
                            <td>{b.allowanceDays}</td>
                            <td><span style={{ color: '#2563eb', fontWeight: 600 }}>{b.chargedDays}</span></td>
                            <td><strong style={{ color: '#16a34a' }}>{b.remainingDays}</strong></td>
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
                        <th>Phòng ban</th>
                        <th>Lương cơ bản</th>
                        <th>Ngày công</th>
                        <th>Lương Gross</th>
                        <th>Phụ cấp</th>
                        <th>Thưởng</th>
                        <th>Khấu trừ</th>
                        <th>Thực lĩnh (Net)</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu phiếu lương trong kỳ này.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.id || item.employeeCode}>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.baseSalary)}</td>
                            <td>{item.actualWorkingDays} / {item.standardDays}</td>
                            <td><strong>{formatVND(item.grossPay)}</strong></td>
                            <td>{formatVND(item.totalAllowances)}</td>
                            <td>{formatVND(item.totalBonuses)}</td>
                            <td style={{ color: '#dc2626' }}>{formatVND(item.totalDeductions)}</td>
                            <td><strong style={{ color: '#16a34a' }}>{formatVND(item.netPay)}</strong></td>
                            <td><span className={`rpt-status-pill rpt-status-${(item.status || 'draft').toLowerCase()}`}>{item.status}</span></td>
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
                        <th>Phòng ban</th>
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
                        <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu cơ cấu lương.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.employeeCode}>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.nonTaxableAllowances)}</td>
                            <td>{formatVND(item.taxableAllowances)}</td>
                            <td>{formatVND(item.totalBonuses)}</td>
                            <td style={{ color: '#dc2626' }}>{formatVND(item.statutoryDeductions)}</td>
                            <td style={{ color: '#d97706' }}>{formatVND(item.pitDeduction)}</td>
                            <td>{formatVND(item.otherDeductions)}</td>
                            <td><strong>{formatVND(item.grossPay)}</strong></td>
                            <td><strong style={{ color: '#16a34a' }}>{formatVND(item.netPay)}</strong></td>
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
                        <th>Phòng ban</th>
                        <th>Kỳ trước (Net)</th>
                        <th>Kỳ này (Net)</th>
                        <th>Chênh lệch (VNĐ)</th>
                        <th>Tỷ lệ (%)</th>
                        <th>Cảnh báo biến động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu biến động giữa hai kỳ.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.employeeCode}>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{formatVND(item.compareNetPay)}</td>
                            <td><strong>{formatVND(item.currentNetPay)}</strong></td>
                            <td style={{ color: item.varianceAmount >= 0 ? '#16a34a' : '#dc2626' }}>
                              {item.varianceAmount >= 0 ? '+' : ''}{formatVND(item.varianceAmount)}
                            </td>
                            <td>
                              {item.variancePct >= 0 ? '+' : ''}{item.variancePct}%
                            </td>
                            <td>
                              {item.isAnomalous ? (
                                <span className="rpt-status-pill rpt-status-late" style={{ fontWeight: 700 }}>
                                  ⚠ Biến động &ge; 20%
                                </span>
                              ) : (
                                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Bình thường</span>
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
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu phân bổ chi phí.</td></tr>
                      ) : (
                        (reportData?.departments || reportData?.items || []).map((item: any) => (
                          <tr key={item.departmentCode || item.departmentId}>
                            <td><strong>{item.departmentCode}</strong></td>
                            <td>{item.departmentName}</td>
                            <td><span className="rpt-badge accounting">{item.vasAccountFull || item.vasAccount}</span></td>
                            <td>{item.headcount} người</td>
                            <td>{formatVND(item.grossSalary || item.grossPay)}</td>
                            <td>{formatVND(item.employerInsurance || item.employerStatutory)}</td>
                            <td>{formatVND(item.employerUnion || item.tradeUnion)}</td>
                            <td><strong style={{ color: '#2563eb' }}>{formatVND(item.totalCostToCompany)}</strong></td>
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
                        <th>Phòng ban</th>
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
                        <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu công nợ lương.</td></tr>
                      ) : (
                        reportData?.items?.map((item: any) => (
                          <tr key={item.employeeCode}>
                            <td><strong>{item.employeeCode}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.departmentName}</td>
                            <td>{item.bankName}</td>
                            <td><code>{item.bankAccountNumber}</code></td>
                            <td><strong>{formatVND(item.netPayable)}</strong></td>
                            <td style={{ color: '#16a34a' }}>{formatVND(item.totalPaid)}</td>
                            <td>
                              <strong style={{ color: item.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                                {formatVND(item.remainingBalance)}
                              </strong>
                            </td>
                            <td>
                              <span className={`rpt-status-pill rpt-status-${(item.settlementStatus || 'unpaid').toLowerCase()}`}>
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
                        <th>Trạng thái</th>
                        <th>Người ghi sổ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData?.items?.length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Không có dữ liệu sổ nhật ký bút toán.</td></tr>
                      ) : (
                        reportData?.items?.map((entry: any) => (
                          <tr key={entry.id}>
                            <td><strong>{entry.entryNumber}</strong></td>
                            <td>{entry.entryDate}</td>
                            <td>{entry.description}</td>
                            <td style={{ minWidth: '280px' }}>
                              {entry.lines?.map((line: any, idx: number) => (
                                <div key={idx} style={{ fontSize: '0.8rem', lineHeight: '1.4', padding: '2px 0' }}>
                                  {parseFloat(line.debitAmount) > 0 ? (
                                    <span><strong>Nợ {line.accountCode}</strong> ({line.accountName}): {formatVND(line.debitAmount)}</span>
                                  ) : (
                                    <span style={{ paddingLeft: '1rem' }}>Có {line.accountCode} ({line.accountName}): {formatVND(line.creditAmount)}</span>
                                  )}
                                </div>
                              ))}
                            </td>
                            <td>
                              <div>Nợ: <strong>{formatVND(entry.totalDebit)}</strong></div>
                              <div>Có: <strong>{formatVND(entry.totalCredit)}</strong></div>
                            </td>
                            <td>
                              <span className={`rpt-status-pill rpt-status-${(entry.status || 'draft').toLowerCase()}`}>
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
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{entry.postedAt ? new Date(entry.postedAt).toLocaleDateString('vi-VN') : ''}</div>
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
                      Hiển thị trang <strong>{reportData.pagination.page}</strong> / <strong>{reportData.pagination.totalPages}</strong> ({reportData.pagination.totalRows} kết quả)
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="secondary"
                        disabled={page <= 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                      >
                        ← Trang trước
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={page >= reportData.pagination.totalPages}
                        onClick={() => setPage(p => p + 1)}
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
