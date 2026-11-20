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

export function Payroll({ profile, view = 'periods' }: { profile: Profile; view?: 'periods' | 'components' | 'my-slips' }) {
  const [activeTab, setActiveTab] = useState<'periods' | 'components' | 'my-slips'>(view);
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

  const orgPath = `/api/organizations/${profile.organization.id}/payroll`;

  const loadPeriods = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await request<{ items: PayrollPeriod[] }>(`${orgPath}/periods`);
      setPeriods(res.items);
      if (res.items.length > 0 && !selectedPeriod) {
        selectPeriod(res.items[0]);
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
      setPeriodSlips(slipsRes.items);
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
      setComponents(res.items);
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
      setMySlips(res.items);
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

  const handleStatusTransition = async (nextStatus: 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'CLOSED') => {
    if (!selectedPeriod) return;
    try {
      setLoading(true);
      setError(null);
      await request(`${orgPath}/periods/${selectedPeriod.id}/status`, {
        status: nextStatus,
      }, 'PATCH');
      setSuccess(`Đã chuyển trạng thái kỳ lương sang: ${statusLabels[nextStatus]}`);
      await selectPeriod(selectedPeriod);
      await loadPeriods();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleViewSlip = async (slipId: string) => {
    try {
      setLoading(true);
      const res = await request<{ slip: PayrollSlip; items: PayrollSlipItem[] }>(`${orgPath}/slips/${slipId}`);
      setSelectedSlip(res.slip);
      setSelectedSlipItems(res.items);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
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
        standardWorkingDays: Number(fd.get('standardWorkingDays')) || 22,
        notes: fd.get('notes') || undefined,
      });
      setShowCreatePeriod(false);
      setSuccess('Đã tạo kỳ lương mới thành công.');
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
      await request(`${orgPath}/components`, {
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

  const filteredSlips = periodSlips.filter(s =>
    !slipsSearch ||
    s.fullName.toLowerCase().includes(slipsSearch.toLowerCase()) ||
    s.employeeCode.toLowerCase().includes(slipsSearch.toLowerCase())
  );

  return (
    <div className="payroll-container">
      <div className="payroll-header">
        <div>
          <h2>Quản lý Tiền lương & Bảng lương</h2>
          <p className="text-muted">Quản lý cấu phần lương, tính lương theo kỳ, xét duyệt và xuất phiếu lương</p>
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
                  if (found) void selectPeriod(found);
                }}
                disabled={loading}
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) — {statusLabels[p.status]}
                  </option>
                ))}
              </select>
            </div>

            {isHR && (
              <button
                type="button"
                className="button-primary"
                onClick={() => setShowCreatePeriod(true)}
              >
                + Tạo kỳ lương mới
              </button>
            )}
          </div>

          {selectedPeriod && (
            <>
              {/* Summary Cards */}
              <div className="payroll-summary-grid">
                <div className="payroll-summary-card">
                  <span className="payroll-summary-label">Trạng thái kỳ</span>
                  <div>
                    <span className={`payroll-status-badge payroll-status-${selectedPeriod.status}`}>
                      {statusLabels[selectedPeriod.status]}
                    </span>
                  </div>
                  <small style={{ color: '#64748b' }}>Từ {selectedPeriod.startDate} đến {selectedPeriod.endDate}</small>
                </div>

                <div className="payroll-summary-card">
                  <span className="payroll-summary-label">Số phiếu lương</span>
                  <span className="payroll-summary-value">{periodSummary?.totalSlips ?? 0}</span>
                  <small style={{ color: '#64748b' }}>{selectedPeriod.standardWorkingDays} ngày công chuẩn</small>
                </div>

                <div className="payroll-summary-card">
                  <span className="payroll-summary-label">Tổng quỹ lương Gross</span>
                  <span className="payroll-summary-value">{formatVND(periodSummary?.totalGross)}</span>
                  <small style={{ color: '#64748b' }}>Bao gồm phụ cấp & thưởng</small>
                </div>

                <div className="payroll-summary-card">
                  <span className="payroll-summary-label">Tổng thực lĩnh (Net)</span>
                  <span className="payroll-summary-value" style={{ color: '#16a34a' }}>
                    {formatVND(periodSummary?.totalNet)}
                  </span>
                  <small style={{ color: '#64748b' }}>Sau khi trừ các khoản giảm trừ</small>
                </div>
              </div>

              {/* Actions toolbar */}
              {isHR && (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {selectedPeriod.status !== 'CLOSED' && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleCalculateDraft}
                      disabled={loading}
                    >
                      🔄 Tính toán bảng lương nháp
                    </button>
                  )}

                  {selectedPeriod.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => handleStatusTransition('UNDER_REVIEW')}
                      disabled={loading}
                    >
                      📤 Gửi kiểm tra
                    </button>
                  )}

                  {selectedPeriod.status === 'UNDER_REVIEW' && (
                    <>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => handleStatusTransition('DRAFT')}
                        disabled={loading}
                      >
                        ↩ Trả về bản nháp
                      </button>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => handleStatusTransition('APPROVED')}
                        disabled={loading}
                      >
                        ✓ Phê duyệt bảng lương
                      </button>
                    </>
                  )}

                  {selectedPeriod.status === 'APPROVED' && (
                    <button
                      type="button"
                      className="button-primary"
                      style={{ background: '#16a34a', borderColor: '#16a34a' }}
                      onClick={() => handleStatusTransition('CLOSED')}
                      disabled={loading}
                    >
                      🔒 Chốt kỳ lương & Khóa sổ
                    </button>
                  )}

                  {selectedPeriod.status === 'CLOSED' && (
                    <span style={{ fontSize: '0.875rem', color: '#16a34a', fontWeight: 600 }}>
                      ✓ Kỳ lương đã chốt. Dữ liệu được bảo toàn và chống sửa đổi.
                    </span>
                  )}
                </div>
              )}

              {/* Slips table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3>Danh sách phiếu lương ({filteredSlips.length})</h3>
                  <input
                    type="search"
                    placeholder="Tìm theo tên hoặc mã nhân viên..."
                    value={slipsSearch}
                    onChange={e => setSlipsSearch(e.target.value)}
                    style={{ maxWidth: 300 }}
                  />
                </div>

                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mã NV</th>
                        <th>Họ và tên</th>
                        <th>Phòng ban</th>
                        <th>Chế độ</th>
                        <th>Ngày công</th>
                        <th>Lương cơ bản</th>
                        <th>Thực lĩnh (Net)</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSlips.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                            Chưa có phiếu lương trong kỳ này. Nhấn &quot;Tính toán bảng lương nháp&quot; để tạo.
                          </td>
                        </tr>
                      ) : (
                        filteredSlips.map(s => (
                          <tr key={s.id}>
                            <td><strong>{s.employeeCode}</strong></td>
                            <td>{s.fullName}</td>
                            <td>{s.departmentName || '—'}</td>
                            <td><span className="tag">{s.salaryMode}</span></td>
                            <td>{s.actualWorkingDays} thực tế + {s.paidLeaveDays} phép</td>
                            <td>{formatVND(s.baseSalary)}</td>
                            <td><strong style={{ color: '#16a34a' }}>{formatVND(s.netPay)}</strong></td>
                            <td>
                              <button
                                type="button"
                                className="button-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                                onClick={() => handleViewSlip(s.id)}
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
            </>
          )}
        </div>
      )}

      {/* VIEW: SALARY COMPONENTS */}
      {activeTab === 'components' && isHR && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="payroll-toolbar">
            <h3>Danh mục Cấu phần lương & Phụ cấp</h3>
            <button
              type="button"
              className="button-primary"
              onClick={() => setShowCreateComponent(true)}
            >
              + Thêm cấu phần mới
            </button>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên cấu phần</th>
                  <th>Phân loại</th>
                  <th>Cách tính</th>
                  <th>Mức mặc định</th>
                  <th>Chịu thuế</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {components.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                      Chưa có cấu phần lương nào được định nghĩa.
                    </td>
                  </tr>
                ) : (
                  components.map(c => (
                    <tr key={c.id}>
                      <td><code>{c.code}</code></td>
                      <td><strong>{c.name}</strong></td>
                      <td><span className="tag">{typeLabels[c.type] || c.type}</span></td>
                      <td>{c.calculationType}</td>
                      <td>{formatVND(c.defaultAmount)}</td>
                      <td>{c.isTaxable ? 'Có' : 'Không'}</td>
                      <td>{c.active ? 'Đang dùng' : 'Ngưng dùng'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: MY PAYSLIPS */}
      {activeTab === 'my-slips' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3>Phiếu lương cá nhân</h3>
          <p className="text-muted">Lịch sử thu nhập và chi tiết các khoản lương của bạn qua các kỳ</p>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kỳ lương</th>
                  <th>Thời gian</th>
                  <th>Ngày công tính lương</th>
                  <th>Lương cơ bản</th>
                  <th>Phụ cấp & Thưởng</th>
                  <th>Khấu trừ</th>
                  <th>Thực lĩnh (Net)</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {mySlips.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                      Bạn chưa có phiếu lương nào được ghi nhận.
                    </td>
                  </tr>
                ) : (
                  mySlips.map(s => (
                    <tr key={s.id}>
                      <td><strong>{s.periodName || s.periodCode}</strong></td>
                      <td>{s.periodStartDate} ~ {s.periodEndDate}</td>
                      <td>{s.actualWorkingDays} ngày ({s.paidLeaveDays} phép)</td>
                      <td>{formatVND(s.baseSalary)}</td>
                      <td>{formatVND(Number(s.totalAllowances) + Number(s.totalBonuses))}</td>
                      <td>{formatVND(s.totalDeductions)}</td>
                      <td><strong style={{ color: '#16a34a' }}>{formatVND(s.netPay)}</strong></td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                          onClick={() => handleViewSlip(s.id)}
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

      {/* MODAL: CREATE PERIOD */}
      {showCreatePeriod && (
        <dialog open className="dialog-modal" style={{ maxWidth: 500 }}>
          <form onSubmit={handleCreatePeriod}>
            <h3>Tạo kỳ lương mới</h3>
            <div className="form-group">
              <label htmlFor="period-code">Mã kỳ (VD: KY-2026-11):</label>
              <input id="period-code" name="code" required maxLength={30} placeholder="KY-2026-11" />
            </div>
            <div className="form-group">
              <label htmlFor="period-name">Tên kỳ lương:</label>
              <input id="period-name" name="name" required maxLength={120} placeholder="Kỳ lương Tháng 11/2026" />
            </div>
            <div className="form-row" style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="period-start">Từ ngày:</label>
                <input id="period-start" name="startDate" type="date" required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="period-end">Đến ngày:</label>
                <input id="period-end" name="endDate" type="date" required />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="period-days">Số ngày công chuẩn (VD: 22):</label>
              <input id="period-days" name="standardWorkingDays" type="number" defaultValue={22} min={1} max={31} required />
            </div>
            <div className="form-group">
              <label htmlFor="period-notes">Ghi chú:</label>
              <textarea id="period-notes" name="notes" maxLength={500} rows={3}></textarea>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="button-secondary" onClick={() => setShowCreatePeriod(false)}>Hủy</button>
              <button type="submit" className="button-primary" disabled={loading}>Lưu kỳ lương</button>
            </div>
          </form>
        </dialog>
      )}

      {/* MODAL: CREATE COMPONENT */}
      {showCreateComponent && (
        <dialog open className="dialog-modal" style={{ maxWidth: 500 }}>
          <form onSubmit={handleCreateComponent}>
            <h3>Thêm cấu phần lương mới</h3>
            <div className="form-group">
              <label htmlFor="comp-code">Mã cấu phần (chữ hoa không dấu):</label>
              <input id="comp-code" name="code" required maxLength={30} placeholder="PHU_CAP_COM" />
            </div>
            <div className="form-group">
              <label htmlFor="comp-name">Tên cấu phần:</label>
              <input id="comp-name" name="name" required maxLength={120} placeholder="Phụ cấp ăn trưa" />
            </div>
            <div className="form-group">
              <label htmlFor="comp-type">Phân loại:</label>
              <select id="comp-type" name="type" required>
                <option value="ALLOWANCE">Phụ cấp</option>
                <option value="BONUS">Thưởng</option>
                <option value="DEDUCTION">Khấu trừ</option>
                <option value="BASE_SALARY">Lương cơ bản</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="comp-amount">Mức mặc định (VNĐ):</label>
              <input id="comp-amount" name="defaultAmount" type="number" min={0} defaultValue={0} required />
            </div>
            <div className="form-group" style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input name="isTaxable" type="checkbox" defaultChecked />
                <span>Chịu thuế TNCN</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input name="isStatutory" type="checkbox" />
                <span>Khoản bắt buộc theo luật</span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="button-secondary" onClick={() => setShowCreateComponent(false)}>Hủy</button>
              <button type="submit" className="button-primary" disabled={loading}>Thêm cấu phần</button>
            </div>
          </form>
        </dialog>
      )}

      {/* MODAL: SLIP DETAIL BREAKDOWN */}
      {selectedSlip && (
        <dialog open className="dialog-modal" style={{ maxWidth: 650 }}>
          <div className="payroll-slip-detail-header">
            <div>
              <h3>Phiếu lương: {selectedSlip.fullName}</h3>
              <p className="text-muted">
                Mã NV: <strong>{selectedSlip.employeeCode}</strong> | {selectedSlip.departmentName || 'Chưa xếp phòng ban'}
              </p>
              <small>{selectedSlip.periodName || selectedSlip.periodCode} ({selectedSlip.periodStartDate} ~ {selectedSlip.periodEndDate})</small>
            </div>
            <button type="button" className="button-secondary" onClick={() => setSelectedSlip(null)}>✕ Đóng</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: 6 }}>
            <div><span>Chế độ tính lương:</span> <strong>{selectedSlip.salaryMode}</strong></div>
            <div><span>Ngày công chuẩn:</span> <strong>{selectedSlip.standardDays} ngày</strong></div>
            <div><span>Ngày công thực tế:</span> <strong>{selectedSlip.actualWorkingDays} ngày</strong></div>
            <div><span>Nghỉ phép hưởng lương:</span> <strong>{selectedSlip.paidLeaveDays} ngày</strong></div>
          </div>

          <div className="payroll-item-list">
            <h4>Chi tiết các khoản thu nhập & khấu trừ</h4>
            <div className="payroll-item-row">
              <span>Lương cơ bản thỏa thuận:</span>
              <span>{formatVND(selectedSlip.baseSalary)}</span>
            </div>
            <div className="payroll-item-row">
              <span>Lương theo ngày công làm việc:</span>
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
