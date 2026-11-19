import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSlideClose } from './useSlideClose';
import { request, errorText, type Profile } from './api';
import {
  type Employee,
  type EmployeeContract,
  type WorkHistory,
  type EmployeePage,
  employmentLabels,
  contractLabels,
  contractTypeLabels,
} from './employee-types';
import { SearchChoice } from './Employees';
import './drawers.css';
import './employees.css';

const dateLabel = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : '—';

const historyLabels: Record<string, string> = {
  PROFILE_CREATED: 'Tạo hồ sơ',
  ASSIGNMENT_CHANGED: 'Cập nhật công tác',
  ACCOUNT_LINKED: 'Liên kết tài khoản',
};

type Props = {
  id: string;
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
};

export function EmployeeDetailDrawer({ id, profile, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);

  const [detail, setDetail] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [today, setToday] = useState('');

  const [tab, setTab] = useState<'profile' | 'contracts' | 'history'>('profile');
  const [contracts, setContracts] = useState<EmployeePage<EmployeeContract> | null>(null);
  const [history, setHistory] = useState<EmployeePage<WorkHistory> | null>(null);
  const [contractPage, setContractPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState('');

  const [editing, setEditing] = useState(false);
  const [contractEditor, setContractEditor] = useState<EmployeeContract | 'new' | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [termination, setTermination] = useState<EmployeeContract | null>(null);

  const [account, setAccount] = useState('');
  const [dept, setDept] = useState('');
  const [position, setPosition] = useState('');
  const [manager, setManager] = useState('');

  const base = '/api/organizations/' + encodeURIComponent(profile.organization.id);
  const url = base + '/employees';
  const { closing, dismiss } = useSlideClose(onClose);

  const canEdit = Boolean(detail?.canEdit);
  const canContracts = Boolean(
    detail && (['ADMIN', 'HR'].includes(profile.organization.role) || detail.userId === profile.user.id)
  );

  useEffect(() => {
    const modal = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    modal.showModal();
    heading.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const loadDetail = () => {
    alive.current = true;
    let active = true;
    request<{ employee: Employee; today: string }>(url + '/' + encodeURIComponent(id))
      .then(r => {
        if (active) {
          setDetail(r.employee);
          setToday(r.today);
          setDept(r.employee.departmentId || '');
          setPosition(r.employee.positionId || '');
          setManager(r.employee.managerUserId || '');
        }
      })
      .catch(e => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  };

  useEffect(() => {
    loadDetail();
  }, [url, id]);

  useEffect(() => {
    if (!detail || tab === 'profile') return;
    if (tab === 'contracts' && !canContracts) return;
    let active = true;
    setSectionLoading(true);
    setSectionError('');
    const path =
      url +
      '/' +
      detail.id +
      (tab === 'contracts' ? '/contracts?page=' + contractPage : '/work-history?page=' + historyPage);
    request<EmployeePage<EmployeeContract> | EmployeePage<WorkHistory>>(path)
      .then(r => {
        if (active) {
          if (tab === 'contracts') setContracts(r as EmployeePage<EmployeeContract>);
          else setHistory(r as EmployeePage<WorkHistory>);
        }
      })
      .catch(e => {
        if (active) setSectionError(errorText(e));
      })
      .finally(() => {
        if (active) setSectionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, detail?.id, tab, contractPage, historyPage, canContracts]);

  function close() {
    if (busy || closing) return;
    dismiss();
  }

  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
      onSaved();
      loadDetail();
      setEditing(false);
      setContractEditor(null);
      setTransferring(false);
      setTermination(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const nullable = (f: FormData, name: string) => String(f.get(name) || '').trim() || null;

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail) return;
    const f = new FormData(e.currentTarget);
    void perform(
      () =>
        request(
          url + '/' + detail.id,
          {
            version: detail.version,
            employeeCode: String(f.get('employeeCode')),
            fullName: String(f.get('fullName')),
            employmentStatus: String(f.get('employmentStatus')),
            birthDate: nullable(f, 'birthDate'),
            phone: nullable(f, 'phone'),
            personalEmail: nullable(f, 'personalEmail'),
            address: nullable(f, 'address'),
          },
          'PATCH'
        ),
      'Đã cập nhật thông tin hồ sơ.'
    );
  }

  function submitContract(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail) return;
    const f = new FormData(e.currentTarget);
    const item = contractEditor === 'new' ? null : contractEditor;
    const data = {
      contractNumber: String(f.get('contractNumber')),
      contractType: String(f.get('contractType')),
      startDate: String(f.get('startDate')),
      endDate: nullable(f, 'endDate'),
      signedOn: nullable(f, 'signedOn'),
      notes: nullable(f, 'notes'),
    };
    void perform(
      () =>
        item
          ? request(url + '/' + detail.id + '/contracts/' + item.id, { ...data, version: item.version }, 'PATCH')
          : request(url + '/' + detail.id + '/contracts', data),
      'Đã lưu hợp đồng lao động.'
    );
  }

  function submitTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail) return;
    const f = new FormData(e.currentTarget);
    void perform(
      () =>
        request(url + '/' + detail.id + '/work-history', {
          version: detail.version,
          effectiveOn: String(f.get('effectiveOn')),
          reason: String(f.get('reason')),
          departmentId: dept || null,
          positionId: position || null,
          managerUserId: manager || null,
        }),
      'Đã ghi nhận điều chuyển công tác.'
    );
  }

  function changeContract(c: EmployeeContract, status: string, terminationDate?: string) {
    if (!detail) return;
    void perform(
      () =>
        request(
          url + '/' + detail.id + '/contracts/' + c.id,
          { version: c.version, status, ...(terminationDate ? { terminationDate } : {}) },
          'PATCH'
        ),
      'Đã cập nhật trạng thái hợp đồng.'
    );
  }

  function initials(name: string) {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(-2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  function drawerPagination(current: number, total: number, set: (p: number) => void) {
    if (total <= 20) return null;
    return (
      <div className="emp-pagination">
        <button className="secondary" disabled={current === 1 || sectionLoading} onClick={() => set(current - 1)}>
          Trước
        </button>
        <span>
          Trang {current} · {total} kết quả
        </span>
        <button
          className="secondary"
          disabled={current * 20 >= total || sectionLoading}
          onClick={() => set(current + 1)}
        >
          Sau
        </button>
      </div>
    );
  }

  return createPortal(
    <dialog
      ref={dialog}
      className={'account-drawer emp-drawer' + (closing ? ' is-closing' : '')}
      aria-labelledby="employee-detail-title"
      aria-modal="true"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      <header className="drawer-header">
        <div>
          <span className="eyebrow">{detail ? detail.employeeCode : 'HỒ SƠ NHÂN VIÊN'}</span>
          <h2 id="employee-detail-title" ref={heading} tabIndex={-1}>
            {detail ? detail.fullName : 'Chi tiết nhân viên'}
          </h2>
        </div>
        <button className="secondary" onClick={close} disabled={busy || closing} aria-label="Đóng chi tiết">
          ×
        </button>
      </header>

      <div className="drawer-body" inert={closing} aria-busy={loading || busy}>
        {error && <p role="alert" className="notice error">{error}</p>}
        {success && <p role="status" className="notice success">{success}</p>}
        {loading && <p role="status">Đang tải hồ sơ nhân viên…</p>}

        {detail && (
          <>
            <div className="emp-summary-header">
              <span className="drawer-profile-avatar" aria-hidden="true">
                {initials(detail.fullName)}
              </span>
              <div className="emp-summary-info">
                <h3>{detail.fullName}</h3>
                <p className="emp-summary-subtitle">
                  {detail.positionTitle || 'Chưa có chức danh'} · {detail.departmentName || 'Chưa phân công'}
                </p>
                <div className="emp-badges-row">
                  <span className={`emp-badge emp-badge-${detail.employmentStatus.toLowerCase()}`}>
                    {employmentLabels[detail.employmentStatus]}
                  </span>
                  {detail.userId ? (
                    <span className="emp-badge emp-badge-linked">Đã liên kết tài khoản</span>
                  ) : (
                    <span className="emp-badge emp-badge-standalone">Hồ sơ độc lập</span>
                  )}
                </div>
              </div>
            </div>

            <nav className="emp-drawer-tabs" role="tablist" aria-label="Nội dung hồ sơ">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'profile'}
                className={'emp-drawer-tab' + (tab === 'profile' ? ' is-active' : '')}
                onClick={() => {
                  setTab('profile');
                  setEditing(false);
                }}
              >
                Thông tin hồ sơ
              </button>
              {canContracts && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'contracts'}
                  className={'emp-drawer-tab' + (tab === 'contracts' ? ' is-active' : '')}
                  onClick={() => {
                    setTab('contracts');
                    setContractEditor(null);
                    setTermination(null);
                  }}
                >
                  Hợp đồng lao động
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'history'}
                className={'emp-drawer-tab' + (tab === 'history' ? ' is-active' : '')}
                onClick={() => {
                  setTab('history');
                  setTransferring(false);
                }}
              >
                Lịch sử công tác
              </button>
            </nav>

            {tab === 'profile' && !editing && (
              <div className="emp-tab-panel">
                <section className="emp-card">
                  <div className="emp-card-header">
                    <h4>Thông tin công tác</h4>
                    {canEdit && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditing(true)}
                      >
                        Chỉnh sửa hồ sơ
                      </button>
                    )}
                  </div>
                  <dl className="drawer-detail-list">
                    <div>
                      <dt>Mã nhân viên</dt>
                      <dd><strong>{detail.employeeCode}</strong></dd>
                    </div>
                    <div>
                      <dt>Ngày vào làm</dt>
                      <dd>{dateLabel(detail.hireDate)}</dd>
                    </div>
                    <div>
                      <dt>Trạng thái</dt>
                      <dd>
                        <span className={`emp-badge emp-badge-${detail.employmentStatus.toLowerCase()}`}>
                          {employmentLabels[detail.employmentStatus]}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Phòng ban</dt>
                      <dd>{detail.departmentName || 'Chưa phân công'}</dd>
                    </div>
                    <div>
                      <dt>Chức danh</dt>
                      <dd>{detail.positionTitle || 'Chưa phân công'}</dd>
                    </div>
                    <div>
                      <dt>Quản lý trực tiếp</dt>
                      <dd>{detail.managerName || 'Chưa phân công'}</dd>
                    </div>
                  </dl>
                </section>

                {(detail.birthDate !== undefined ||
                  detail.phone !== undefined ||
                  detail.personalEmail !== undefined ||
                  detail.address !== undefined) && (
                  <section className="emp-card">
                    <div className="emp-card-header">
                      <h4>Thông tin cá nhân</h4>
                      <small className="muted">Chỉ hiển thị cho người có thẩm quyền</small>
                    </div>
                    <dl className="drawer-detail-list">
                      <div>
                        <dt>Ngày sinh</dt>
                        <dd>{dateLabel(detail.birthDate)}</dd>
                      </div>
                      <div>
                        <dt>Điện thoại</dt>
                        <dd>{detail.phone || '—'}</dd>
                      </div>
                      <div>
                        <dt>Email cá nhân</dt>
                        <dd>{detail.personalEmail || '—'}</dd>
                      </div>
                      <div>
                        <dt>Địa chỉ</dt>
                        <dd>{detail.address || '—'}</dd>
                      </div>
                    </dl>
                  </section>
                )}

                {profile.organization.role === 'ADMIN' && !detail.userId && (
                  <form
                    className="emp-card emp-link-card"
                    onSubmit={e => {
                      e.preventDefault();
                      void perform(
                        () => request(url + '/' + detail.id + '/account', { version: detail.version, userId: account }),
                        'Đã liên kết tài khoản thành công.'
                      );
                    }}
                  >
                    <h4>Liên kết tài khoản người dùng</h4>
                    <p className="muted">Liên kết hồ sơ này với một tài khoản đã được mời trong tổ chức.</p>
                    <SearchChoice
                      base={base}
                      resource="users"
                      label="Tài khoản liên kết"
                      value={account}
                      onChange={setAccount}
                    />
                    <div className="emp-actions">
                      <button className="primary" disabled={!account || busy}>
                        Xác nhận liên kết
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {tab === 'profile' && editing && (
              <form className="emp-card emp-edit-form" onSubmit={submitProfile}>
                <div className="emp-card-header">
                  <h4>Chỉnh sửa hồ sơ nhân viên</h4>
                </div>
                <fieldset disabled={busy} className="emp-form-stack">
                  <label className="field">
                    <span>Mã nhân viên</span>
                    <input name="employeeCode" required maxLength={30} defaultValue={detail.employeeCode} />
                  </label>
                  <label className="field">
                    <span>Họ và tên</span>
                    <input name="fullName" required maxLength={150} defaultValue={detail.fullName} />
                  </label>
                  <label className="field">
                    <span>Trạng thái làm việc</span>
                    <select name="employmentStatus" defaultValue={detail.employmentStatus}>
                      {Object.entries(employmentLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Ngày sinh</span>
                    <input name="birthDate" type="date" defaultValue={detail.birthDate || ''} />
                  </label>
                  <label className="field">
                    <span>Số điện thoại</span>
                    <input name="phone" type="tel" maxLength={32} defaultValue={detail.phone || ''} />
                  </label>
                  <label className="field">
                    <span>Email cá nhân</span>
                    <input name="personalEmail" type="email" maxLength={254} defaultValue={detail.personalEmail || ''} />
                  </label>
                  <label className="field">
                    <span>Địa chỉ</span>
                    <input name="address" maxLength={500} defaultValue={detail.address || ''} />
                  </label>
                  <div className="emp-actions">
                    <button className="primary" type="submit">
                      {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditing(false)}>
                      Hủy
                    </button>
                  </div>
                </fieldset>
              </form>
            )}

            {tab === 'contracts' && canContracts && (
              <div className="emp-tab-panel">
                <div className="emp-card-header">
                  <h4>Danh sách hợp đồng lao động</h4>
                  {canEdit && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setContractEditor('new');
                        setTermination(null);
                      }}
                    >
                      Thêm hợp đồng
                    </button>
                  )}
                </div>

                {sectionLoading && <p role="status">Đang tải danh sách hợp đồng…</p>}
                {sectionError && <p role="alert" className="notice error">{sectionError}</p>}

                {contractEditor && (
                  <form className="emp-card emp-editor" onSubmit={submitContract}>
                    <h4>{contractEditor === 'new' ? 'Tạo bản nháp hợp đồng' : 'Chỉnh sửa bản nháp'}</h4>
                    <fieldset disabled={busy} className="emp-form-stack">
                      <label className="field">
                        <span>Số hợp đồng</span>
                        <input
                          name="contractNumber"
                          required
                          maxLength={60}
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.contractNumber}
                        />
                      </label>
                      <label className="field">
                        <span>Loại hợp đồng</span>
                        <select
                          name="contractType"
                          defaultValue={contractEditor === 'new' ? 'FIXED_TERM' : contractEditor.contractType}
                        >
                          {Object.entries(contractTypeLabels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Ngày bắt đầu</span>
                        <input
                          name="startDate"
                          type="date"
                          required
                          defaultValue={contractEditor === 'new' ? today : contractEditor.startDate}
                        />
                      </label>
                      <label className="field">
                        <span>Ngày kết thúc</span>
                        <input
                          name="endDate"
                          type="date"
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.endDate || ''}
                        />
                      </label>
                      <label className="field">
                        <span>Ngày ký</span>
                        <input
                          name="signedOn"
                          type="date"
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.signedOn || ''}
                        />
                      </label>
                      <label className="field">
                        <span>Ghi chú hợp đồng</span>
                        <textarea
                          name="notes"
                          maxLength={1000}
                          rows={2}
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.notes || ''}
                        />
                      </label>
                      <div className="emp-actions">
                        <button className="primary" type="submit">
                          {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
                        </button>
                        <button type="button" className="secondary" onClick={() => setContractEditor(null)}>
                          Hủy
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}

                {termination && (
                  <form
                    className="emp-card emp-editor"
                    onSubmit={e => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      changeContract(termination, 'TERMINATED', String(f.get('terminationDate')));
                    }}
                  >
                    <h4>Chấm dứt hợp đồng {termination.contractNumber}</h4>
                    <label className="field">
                      <span>Ngày chấm dứt</span>
                      <input
                        type="date"
                        name="terminationDate"
                        required
                        min={termination.startDate}
                        max={today}
                        defaultValue={today}
                      />
                    </label>
                    <div className="emp-actions">
                      <button className="primary" disabled={busy}>
                        Xác nhận chấm dứt
                      </button>
                      <button type="button" className="secondary" onClick={() => setTermination(null)}>
                        Hủy
                      </button>
                    </div>
                  </form>
                )}

                <div className="emp-contracts-list">
                  {!sectionLoading &&
                    contracts?.items.map(c => (
                      <article key={c.id} className="emp-contract-card">
                        <div className="emp-contract-top">
                          <div>
                            <span className="eyebrow">{contractTypeLabels[c.contractType]}</span>
                            <h5>{c.contractNumber}</h5>
                          </div>
                          <span className={`emp-badge emp-badge-${c.status.toLowerCase()}`}>
                            {contractLabels[c.status]}
                          </span>
                        </div>
                        <div className="emp-contract-dates">
                          <span>
                            <strong>Thời hạn:</strong> {dateLabel(c.startDate)} → {dateLabel(c.endDate)}
                          </span>
                          {c.signedOn && (
                            <span>
                              <strong>Ngày ký:</strong> {dateLabel(c.signedOn)}
                            </span>
                          )}
                          {c.terminationDate && (
                            <span>
                              <strong>Chấm dứt:</strong> {dateLabel(c.terminationDate)}
                            </span>
                          )}
                        </div>
                        {c.notes && <p className="emp-contract-notes">{c.notes}</p>}
                        {canEdit && (
                          <div className="emp-actions emp-contract-actions">
                            {c.status === 'DRAFT' && (
                              <>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setContractEditor(c)}
                                >
                                  Sửa bản nháp
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => changeContract(c, 'ACTIVE')}
                                >
                                  Kích hoạt
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => changeContract(c, 'CANCELLED')}
                                >
                                  Hủy
                                </button>
                              </>
                            )}
                            {c.status === 'ACTIVE' && (
                              <>
                                {c.endDate && c.endDate < today ? (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() => changeContract(c, 'EXPIRED')}
                                  >
                                    Ghi nhận hết hạn
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => setTermination(c)}
                                  >
                                    Chấm dứt hợp đồng
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  {!sectionLoading && !sectionError && contracts?.items.length === 0 && (
                    <p className="muted">Chưa có hợp đồng lao động nào.</p>
                  )}
                </div>
                {contracts && drawerPagination(contractPage, contracts.total, setContractPage)}
              </div>
            )}

            {tab === 'history' && (
              <div className="emp-tab-panel">
                <div className="emp-card-header">
                  <h4>Lịch sử thay đổi công tác</h4>
                  {canEdit && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setTransferring(true)}
                    >
                      Ghi nhận điều chuyển
                    </button>
                  )}
                </div>

                {sectionLoading && <p role="status">Đang tải lịch sử công tác…</p>}
                {sectionError && <p role="alert" className="notice error">{sectionError}</p>}

                {transferring && (
                  <form className="emp-card emp-editor" onSubmit={submitTransfer}>
                    <h4>Điều chuyển công tác mới</h4>
                    <fieldset disabled={busy} className="emp-form-stack">
                      <label className="field">
                        <span>Ngày hiệu lực</span>
                        <input
                          type="date"
                          name="effectiveOn"
                          required
                          min={detail.hireDate}
                          max={today}
                          defaultValue={today}
                        />
                      </label>
                      <label className="field">
                        <span>Lý do điều chuyển</span>
                        <input name="reason" maxLength={500} required />
                      </label>
                      <SearchChoice
                        base={base}
                        resource="departments"
                        label="Phòng ban mới"
                        value={dept}
                        initialLabel={detail.departmentName}
                        onChange={id => {
                          setDept(id);
                          setPosition('');
                        }}
                      />
                      <SearchChoice
                        base={base}
                        resource="positions"
                        label="Chức danh mới"
                        value={position}
                        initialLabel={detail.positionTitle}
                        departmentId={dept}
                        onChange={setPosition}
                      />
                      {profile.organization.role === 'ADMIN' ? (
                        <SearchChoice
                          base={base}
                          resource="users"
                          role="MANAGER"
                          label="Quản lý mới"
                          value={manager}
                          initialLabel={detail.managerName}
                          onChange={setManager}
                        />
                      ) : (
                        <p className="muted">Chỉ Quản trị viên mới được điều chuyển người quản lý trực tiếp.</p>
                      )}
                      <div className="emp-actions">
                        <button className="primary" type="submit">
                          {busy ? 'Đang lưu…' : 'Lưu điều chuyển'}
                        </button>
                        <button type="button" className="secondary" onClick={() => setTransferring(false)}>
                          Hủy
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}

                <ol className="emp-timeline">
                  {!sectionLoading &&
                    history?.items.map(h => (
                      <li key={h.id} className="emp-timeline-item">
                        <time className="emp-timeline-time">{dateLabel(h.effectiveOn)}</time>
                        <div className="emp-timeline-content">
                          <span className="emp-timeline-badge">{historyLabels[h.reason] || h.reason}</span>
                          <p className="emp-timeline-desc">
                            <strong>{h.departmentName || 'Chưa phân công phòng ban'}</strong> · {h.positionTitle || 'Chưa có chức danh'}
                          </p>
                          <small className="muted">Quản lý trực tiếp: {h.managerName || 'Chưa phân công'}</small>
                        </div>
                      </li>
                    ))}
                  {!sectionLoading && !sectionError && history?.items.length === 0 && (
                    <p className="muted">Chưa có mốc lịch sử công tác nào.</p>
                  )}
                </ol>
                {history && drawerPagination(historyPage, history.total, setHistoryPage)}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="drawer-footer">
        <span>Chỉ hiển thị thông tin trong phạm vi quyền của bạn.</span>
        {busy && <span role="status">Đang lưu, vui lòng đợi…</span>}
      </footer>
    </dialog>,
    document.body
  );
}
