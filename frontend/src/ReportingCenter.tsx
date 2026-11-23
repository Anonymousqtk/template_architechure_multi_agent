import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ApiError, errorText, request, type Department, type Profile } from './api';
import './reporting.css';

export interface ReportItem {
  id?: string;
  code: string;
  category: 'EMPLOYEE' | 'ORGANIZATION' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'COMPLIANCE' | 'OTHER';
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
  }, [activeReport, orgId, page, pageSize, filterDept, filterStatus, filterContractType, filterSearch, startDate, endDate]);

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
        endDate
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
          <p>Báo cáo nhân sự, cơ cấu tổ chức, chấm công, ca làm việc và số dư nghỉ phép.</p>
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
                      placeholder="VD: Nhân sự phòng Dev tháng này"
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
