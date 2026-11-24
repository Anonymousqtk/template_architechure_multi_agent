import { useTranslation } from '../../../i18n';
import { employeeDetailEnglish } from './employeeDetailMessages';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSlideClose } from '../../../hooks/useSlideClose';
import { request, errorText, type Profile } from '../../../services/api';
import { Avatar } from '../../../components/common/Avatar';
import {
  type Employee,
  type EmployeeContract,
  type WorkHistory,
  type DocumentItem,
  type EmployeePage,
  employmentLabels,
  contractLabels,
  contractTypeLabels,
  workEventLabels,
  documentTypeLabels,
} from '../employee-types';
import { SearchChoice } from '../../../pages/Employees/Employees';
import '../../../assets/styles/drawers.css';
import '../../../assets/styles/employees.css';

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

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
  const { locale } = useTranslation();
  const tr = (text: string) => locale === 'en' ? (employeeDetailEnglish[text] ?? text) : text;
  const dateLabel = (value: string | null | undefined) =>
    value ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', { timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : '—';
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);

  const [detail, setDetail] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [today, setToday] = useState('');

  const [tab, setTab] = useState<'profile' | 'contracts' | 'history' | 'documents' | 'salary' | 'insurance'>('profile');
  const [contracts, setContracts] = useState<EmployeePage<EmployeeContract> | null>(null);
  const [history, setHistory] = useState<EmployeePage<WorkHistory> | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [docType, setDocType] = useState<DocumentItem['documentType']>('OTHER');
  const [docDesc, setDocDesc] = useState('');
  const [contractPage, setContractPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState('');

  // PAY-001 Enhancement: Salary & Insurance history state
  interface SalaryProfileHistory {
    id: string; salaryMode: string; baseSalary: string; currency: string;
    effectiveFrom: string | null; effectiveTo: string | null;
    status: string; notes: string | null; createdAt: string;
    components: Array<{ componentId: string; componentName: string; componentCode: string; type: string; amount: string; percentage: string | null; notes: string | null }>;
  }
  interface SIProfile {
    id: string; siCode: string; hiCode: string | null; insuredName: string;
    enrollmentDate: string; terminationDate: string | null; siSalary: string;
    currency: string; status: string; suspensionReason: string | null; notes: string | null;
  }
  interface SIContribution {
    contributionMonth: string; siSalary: string; employeeRate: string; employerRate: string;
    employeeAmount: string; employerAmount: string; status: string;
    adjustmentReason: string | null; notes: string | null; confirmedAt: string | null;
  }
  const [salaryHistory, setSalaryHistory] = useState<{ items: SalaryProfileHistory[]; total: number } | null>(null);
  const [siProfile, setSiProfile] = useState<SIProfile | null>(null);
  const [siContributions, setSiContributions] = useState<SIContribution[]>([]);
  const [salaryPage, setSalaryPage] = useState(1);

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
  const canUploadAvatar = Boolean(
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

  const loadDocuments = () => {
    if (!detail) return;
    let active = true;
    setSectionLoading(true);
    setSectionError('');
    request<{ items: DocumentItem[] }>(url + '/' + detail.id + '/documents')
      .then(r => {
        if (active) setDocuments(r.items);
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
  };

  useEffect(() => {
    if (!detail || tab === 'profile') return;
    if (tab === 'contracts' && !canContracts) return;
    if (tab === 'documents') {
      loadDocuments();
      return;
    }
    if (tab === 'salary') {
      let active = true;
      setSectionLoading(true);
      setSectionError('');
      const payBase = '/api/organizations/' + encodeURIComponent(profile.organization.id) + '/payroll';
      request<{ items: SalaryProfileHistory[]; total: number }>(
        payBase + '/employees/' + detail.id + '/salary-history?page=' + salaryPage + '&limit=10'
      )
        .then(r => { if (active) setSalaryHistory(r); })
        .catch(e => { if (active) setSectionError(errorText(e)); })
        .finally(() => { if (active) setSectionLoading(false); });
      return () => { active = false; };
    }
    if (tab === 'insurance') {
      let active = true;
      setSectionLoading(true);
      setSectionError('');
      const payBase = '/api/organizations/' + encodeURIComponent(profile.organization.id) + '/payroll';
      request<{ profile: SIProfile | null; contributions: SIContribution[] }>(
        payBase + '/employees/' + detail.id + '/social-insurance'
      )
        .then(r => {
          if (active) {
            setSiProfile(r.profile);
            setSiContributions(r.contributions);
          }
        })
        .catch(e => { if (active) setSectionError(errorText(e)); })
        .finally(() => { if (active) setSectionLoading(false); });
      return () => { active = false; };
    }
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
  }, [url, detail?.id, tab, contractPage, historyPage, canContracts, salaryPage, profile.organization.id]);

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
            bankName: nullable(f, 'bankName'),
            bankAccountNumber: nullable(f, 'bankAccountNumber'),
            bankAccountName: nullable(f, 'bankAccountName'),
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

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Chỉ chấp nhận file ảnh JPG hoặc PNG.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Dung lượng ảnh không được vượt quá 5MB.');
      return;
    }
    setBusy(true);
    setError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        await request(
          url + '/' + detail.id + '/avatar',
          {
            fileName: file.name,
            mimeType: file.type,
            contentBase64: base64,
          },
          'POST'
        );
        setSuccess('Đã cập nhật ảnh đại diện thành công.');
        loadDetail();
        onSaved();
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleDocumentUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail) return;
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('docFile') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError('Vui lòng chọn tập tin cần tải lên.');
      return;
    }
    const allowed = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];
    if (!allowed.includes(file.type) && !file.name.endsWith('.csv') && !file.name.endsWith('.xlsx')) {
      setError('Định dạng tập tin không được hỗ trợ. Chấp nhận PDF, JPG, PNG, XLSX, CSV.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Dung lượng tập tin vượt quá giới hạn 10MB.');
      return;
    }
    setDocUploading(true);
    setError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        await request(
          url + '/' + detail.id + '/documents',
          {
            fileName: file.name,
            mimeType: file.type || (file.name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            documentType: docType,
            description: docDesc || null,
            contentBase64: base64,
          },
          'POST'
        );
        setSuccess('Đã tải lên tài liệu thành công.');
        form.reset();
        setDocDesc('');
        setDocType('OTHER');
        loadDocuments();
      } catch (err) {
        setError(errorText(err));
      } finally {
        setDocUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleDownloadDoc(doc: DocumentItem) {
    if (!detail) return;
    try {
      const res = await fetch(url + '/' + detail.id + '/documents/' + doc.id + '/download', {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Không thể tải tập tin');
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function handleDeleteDoc(doc: DocumentItem) {
    if (!detail) return;
    if (!window.confirm(locale === 'en' ? `Delete document "${doc.fileName}"?` : `Bạn có chắc muốn xóa tài liệu "${doc.fileName}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await request(url + '/' + detail.id + '/documents/' + doc.id, {}, 'DELETE');
      setSuccess('Đã xóa tài liệu.');
      loadDocuments();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
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
          eventType: String(f.get('eventType') || 'TRANSFER'),
          title: nullable(f, 'title'),
          notes: nullable(f, 'notes'),
          departmentId: dept || null,
          positionId: position || null,
          managerUserId: manager || null,
        }),
      'Đã ghi nhận mốc công tác.'
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
          <span className="eyebrow">{detail ? detail.employeeCode : tr("HỒ SƠ NHÂN VIÊN")}</span>
          <h2 id="employee-detail-title" ref={heading} tabIndex={-1}>
            {detail ? detail.fullName : tr("Chi tiết nhân viên")}
          </h2>
        </div>
        <button className="secondary" onClick={close} disabled={busy || closing} aria-label={tr("Đóng chi tiết")}>
          ×
        </button>
      </header>

      <div className="drawer-body" inert={closing} aria-busy={loading || busy}>
        {error && <p role="alert" className="notice error">{error}</p>}
        {success && <p role="status" className="notice success">{success}</p>}
        {loading && <p role="status">{tr("Đang tải hồ sơ nhân viên…")}</p>}

        {detail && (
          <>
            <div className="emp-summary-header">
              <div className="drawer-profile-avatar-wrapper">
                <Avatar src={detail.avatarUrl} name={detail.fullName} className="drawer-profile-avatar-img" />
                {canUploadAvatar && (
                  <label className="drawer-avatar-upload-btn" title={tr("Cập nhật ảnh đại diện")}>
                    <span>📷</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleAvatarSelect}
                      style={{ display: 'none' }}
                      disabled={busy}
                    />
                  </label>
                )}
              </div>
              <div className="emp-summary-info">
                <h3>{detail.fullName}</h3>
                <p className="emp-summary-subtitle">
                  {detail.positionTitle || tr("Chưa có chức danh")} · {detail.departmentName || tr("Chưa phân công")}
                </p>
                <div className="emp-badges-row">
                  <span className={`emp-badge emp-badge-${detail.employmentStatus.toLowerCase()}`}>
                    {tr(employmentLabels[detail.employmentStatus])}
                  </span>
                  {detail.userId ? (
                    <span className="emp-badge emp-badge-linked">{tr("Đã liên kết tài khoản")}</span>
                  ) : (
                    <span className="emp-badge emp-badge-standalone">{tr("Hồ sơ độc lập")}</span>
                  )}
                </div>
              </div>
            </div>

            <nav className="emp-drawer-tabs" role="tablist" aria-label={tr("Nội dung hồ sơ")}>
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
                {tr("Thông tin hồ sơ")}
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
                  {tr("Hợp đồng lao động")}
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
                {tr("Lịch sử công tác")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'documents'}
                className={'emp-drawer-tab' + (tab === 'documents' ? ' is-active' : '')}
                onClick={() => {
                  setTab('documents');
                }}
              >
                {tr("Tài liệu đính kèm")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'salary'}
                className={'emp-drawer-tab' + (tab === 'salary' ? ' is-active' : '')}
                onClick={() => { setTab('salary'); setSalaryPage(1); }}
              >
                {tr("Lịch sử lương")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'insurance'}
                className={'emp-drawer-tab' + (tab === 'insurance' ? ' is-active' : '')}
                onClick={() => { setTab('insurance'); }}
              >
                BHXH
              </button>
            </nav>

            {tab === 'profile' && !editing && (
              <div className="emp-tab-panel">
                <section className="emp-card">
                  <div className="emp-card-header">
                    <h4>{tr("Thông tin công tác")}</h4>
                    {canEdit && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditing(true)}
                      >
                        {tr("Chỉnh sửa hồ sơ")}
                      </button>
                    )}
                  </div>
                  <dl className="drawer-detail-list">
                    <div>
                      <dt>{tr("Mã nhân viên")}</dt>
                      <dd><strong>{detail.employeeCode}</strong></dd>
                    </div>
                    <div>
                      <dt>{tr("Ngày vào làm")}</dt>
                      <dd>{dateLabel(detail.hireDate)}</dd>
                    </div>
                    <div>
                      <dt>{tr("Trạng thái")}</dt>
                      <dd>
                        <span className={`emp-badge emp-badge-${detail.employmentStatus.toLowerCase()}`}>
                          {tr(employmentLabels[detail.employmentStatus])}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Phòng ban")}</dt>
                      <dd>{detail.departmentName || tr("Chưa phân công")}</dd>
                    </div>
                    <div>
                      <dt>{tr("Chức danh")}</dt>
                      <dd>{detail.positionTitle || tr("Chưa phân công")}</dd>
                    </div>
                    <div>
                      <dt>{tr("Quản lý trực tiếp")}</dt>
                      <dd>{detail.managerName || tr("Chưa phân công")}</dd>
                    </div>
                  </dl>
                </section>

                {(detail.birthDate !== undefined ||
                  detail.phone !== undefined ||
                  detail.personalEmail !== undefined ||
                  detail.address !== undefined) && (
                  <section className="emp-card">
                    <div className="emp-card-header">
                      <h4>{tr("Thông tin cá nhân")}</h4>
                      <small className="muted">{tr("Chỉ hiển thị cho người có thẩm quyền")}</small>
                    </div>
                    <dl className="drawer-detail-list">
                      <div>
                        <dt>{tr("Ngày sinh")}</dt>
                        <dd>{dateLabel(detail.birthDate)}</dd>
                      </div>
                      <div>
                        <dt>{tr("Điện thoại")}</dt>
                        <dd>{detail.phone || '—'}</dd>
                      </div>
                      <div>
                        <dt>{tr("Email cá nhân")}</dt>
                        <dd>{detail.personalEmail || '—'}</dd>
                      </div>
                      <div>
                        <dt>{tr("Địa chỉ")}</dt>
                        <dd>{detail.address || '—'}</dd>
                      </div>
                    </dl>
                  </section>
                )}

                <section className="emp-card">
                  <div className="emp-card-header">
                    <h4>{tr("Thông tin tài khoản ngân hàng")}</h4>
                    <small className="muted">Dùng cho chi trả lương &amp; thanh toán công tác</small>
                  </div>
                  <dl className="drawer-detail-list">
                    <div>
                      <dt>{tr("Ngân hàng")}</dt>
                      <dd>{detail.bankName || tr("Chưa cập nhật")}</dd>
                    </div>
                    <div>
                      <dt>{tr("Số tài khoản")}</dt>
                      <dd>
                        {detail.bankAccountNumber ? (
                          <code>{detail.bankAccountNumber}</code>
                        ) : (
                          tr("Chưa cập nhật")
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Tên chủ tài khoản")}</dt>
                      <dd>{detail.bankAccountName ? detail.bankAccountName.toUpperCase() : tr("Chưa cập nhật")}</dd>
                    </div>
                  </dl>
                </section>

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
                    <h4>{tr('Liên kết tài khoản người dùng')}</h4>
                    <p className="muted">{tr('Liên kết hồ sơ này với một tài khoản đã được mời trong tổ chức.')}</p>
                    <SearchChoice
                      base={base}
                      resource="users"
                      label={tr("Tài khoản liên kết")}
                      value={account}
                      onChange={setAccount}
                    />
                    <div className="emp-actions">
                      <button className="primary" disabled={!account || busy}>
                        {tr("Xác nhận liên kết")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {tab === 'profile' && editing && (
              <form className="emp-card emp-edit-form" onSubmit={submitProfile}>
                <div className="emp-card-header">
                  <h4>{tr("Chỉnh sửa hồ sơ nhân viên")}</h4>
                </div>
                <fieldset disabled={busy} className="emp-form-stack">
                  <label className="field">
                    <span>{tr("Mã nhân viên")}</span>
                    <input name="employeeCode" required maxLength={30} defaultValue={detail.employeeCode} />
                  </label>
                  <label className="field">
                    <span>{tr("Họ và tên")}</span>
                    <input name="fullName" required maxLength={150} defaultValue={detail.fullName} />
                  </label>
                  <label className="field">
                    <span>{tr("Trạng thái làm việc")}</span>
                    <select name="employmentStatus" defaultValue={detail.employmentStatus}>
                      {Object.entries(employmentLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {tr(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{tr("Ngày sinh")}</span>
                    <input name="birthDate" type="date" defaultValue={detail.birthDate || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Số điện thoại")}</span>
                    <input name="phone" type="tel" maxLength={32} defaultValue={detail.phone || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Email cá nhân")}</span>
                    <input name="personalEmail" type="email" maxLength={254} defaultValue={detail.personalEmail || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Địa chỉ")}</span>
                    <input name="address" maxLength={500} defaultValue={detail.address || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Tên ngân hàng")}</span>
                    <input name="bankName" maxLength={100} placeholder={tr("VD: Vietcombank, Techcombank, MB Bank...")} defaultValue={detail.bankName || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Số tài khoản ngân hàng")}</span>
                    <input name="bankAccountNumber" maxLength={50} placeholder={tr("Nhập số tài khoản ngân hàng")} defaultValue={detail.bankAccountNumber || ''} />
                  </label>
                  <label className="field">
                    <span>{tr("Tên chủ tài khoản")}</span>
                    <input name="bankAccountName" maxLength={150} placeholder={tr("Tên chủ tài khoản (in hoa)")} defaultValue={detail.bankAccountName || ''} />
                  </label>
                  <div className="emp-actions">
                    <button className="primary" type="submit">
                      {busy ? tr("Đang lưu…") : tr("Lưu hồ sơ")}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditing(false)}>
                      {tr("Hủy")}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}

            {tab === 'contracts' && canContracts && (
              <div className="emp-tab-panel">
                <div className="emp-card-header">
                  <h4>{tr("Danh sách hợp đồng lao động")}</h4>
                  {canEdit && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setContractEditor('new');
                        setTermination(null);
                      }}
                    >
                      {tr("Thêm hợp đồng")}
                    </button>
                  )}
                </div>

                {sectionLoading && <p role="status">{tr("Đang tải danh sách hợp đồng…")}</p>}
                {sectionError && <p role="alert" className="notice error">{sectionError}</p>}

                {contractEditor && (
                  <form className="emp-card emp-editor" onSubmit={submitContract}>
                    <h4>{contractEditor === 'new' ? tr("Tạo bản nháp hợp đồng") : tr("Chỉnh sửa bản nháp")}</h4>
                    <fieldset disabled={busy} className="emp-form-stack">
                      <label className="field">
                        <span>{tr("Số hợp đồng")}</span>
                        <input
                          name="contractNumber"
                          required
                          maxLength={60}
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.contractNumber}
                        />
                      </label>
                      <label className="field">
                        <span>{tr("Loại hợp đồng")}</span>
                        <select
                          name="contractType"
                          defaultValue={contractEditor === 'new' ? 'FIXED_TERM' : contractEditor.contractType}
                        >
                          {Object.entries(contractTypeLabels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {tr(l)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>{tr("Ngày bắt đầu")}</span>
                        <input
                          name="startDate"
                          type="date"
                          required
                          defaultValue={contractEditor === 'new' ? today : contractEditor.startDate}
                        />
                      </label>
                      <label className="field">
                        <span>{tr("Ngày kết thúc")}</span>
                        <input
                          name="endDate"
                          type="date"
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.endDate || ''}
                        />
                      </label>
                      <label className="field">
                        <span>{tr("Ngày ký")}</span>
                        <input
                          name="signedOn"
                          type="date"
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.signedOn || ''}
                        />
                      </label>
                      <label className="field">
                        <span>{tr("Ghi chú hợp đồng")}</span>
                        <textarea
                          name="notes"
                          maxLength={1000}
                          rows={2}
                          defaultValue={contractEditor === 'new' ? '' : contractEditor.notes || ''}
                        />
                      </label>
                      <div className="emp-actions">
                        <button className="primary" type="submit">
                          {busy ? tr("Đang lưu…") : tr("Lưu bản nháp")}
                        </button>
                        <button type="button" className="secondary" onClick={() => setContractEditor(null)}>
                          {tr("Hủy")}
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
                    <h4>{tr('Chấm dứt hợp đồng')} {termination.contractNumber}</h4>
                    <label className="field">
                      <span>{tr("Ngày chấm dứt")}</span>
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
                        {tr("Xác nhận chấm dứt")}
                      </button>
                      <button type="button" className="secondary" onClick={() => setTermination(null)}>
                        {tr("Hủy")}
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
                            <span className="eyebrow">{tr(contractTypeLabels[c.contractType])}</span>
                            <h5>{c.contractNumber}</h5>
                          </div>
                          <span className={`emp-badge emp-badge-${c.status.toLowerCase()}`}>
                            {tr(contractLabels[c.status])}
                          </span>
                        </div>
                        <div className="emp-contract-dates">
                          <span>
                            <strong>{tr("Thời hạn:")}</strong> {dateLabel(c.startDate)} → {dateLabel(c.endDate)}
                          </span>
                          {c.signedOn && (
                            <span>
                              <strong>{tr("Ngày ký:")}</strong> {dateLabel(c.signedOn)}
                            </span>
                          )}
                          {c.terminationDate && (
                            <span>
                              <strong>{tr("Chấm dứt:")}</strong> {dateLabel(c.terminationDate)}
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
                                  {tr("Sửa bản nháp")}
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => changeContract(c, 'ACTIVE')}
                                >
                                  {tr("Kích hoạt")}
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => changeContract(c, 'CANCELLED')}
                                >
                                  {tr("Hủy")}
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
                                    {tr("Ghi nhận hết hạn")}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => setTermination(c)}
                                  >
                                    {tr("Chấm dứt hợp đồng")}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  {!sectionLoading && !sectionError && contracts?.items.length === 0 && (
                    <p className="muted">{tr("Chưa có hợp đồng lao động nào.")}</p>
                  )}
                </div>
                {contracts && drawerPagination(contractPage, contracts.total, setContractPage)}
              </div>
            )}

            {tab === 'history' && (
              <div className="emp-tab-panel">
                <div className="emp-card-header">
                  <h4>{tr("Lịch sử thay đổi công tác")}</h4>
                  {canEdit && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setTransferring(true)}
                    >
                      {tr("Ghi nhận điều chuyển")}
                    </button>
                  )}
                </div>

                {sectionLoading && <p role="status">{tr("Đang tải lịch sử công tác…")}</p>}
                {sectionError && <p role="alert" className="notice error">{sectionError}</p>}

                {transferring && (
                  <form className="emp-card emp-editor" onSubmit={submitTransfer}>
                    <h4>{tr("Ghi nhận điều chuyển / bổ nhiệm / khen thưởng")}</h4>
                    <fieldset disabled={busy} className="emp-form-stack">
                      <label className="field">
                        <span>{tr("Loại sự kiện công tác")}</span>
                        <select name="eventType" defaultValue="TRANSFER">
                          {Object.entries(workEventLabels).map(([val, lbl]) => (
                            <option key={val} value={val}>
                              {tr(lbl)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>{tr("Tiêu đề quyết định / sự kiện (tùy chọn)")}</span>
                        <input name="title" maxLength={200} placeholder={tr("VD: Quyết định bổ nhiệm số 05/QĐ-BGD")} />
                      </label>
                      <label className="field">
                        <span>{tr("Ngày hiệu lực")}</span>
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
                        <span>{tr("Lý do điều chuyển")}</span>
                        <input name="reason" maxLength={500} required placeholder={tr("Căn cứ nhu cầu công tác...")} />
                      </label>
                      <label className="field">
                        <span>{tr("Ghi chú bổ sung (tùy chọn)")}</span>
                        <input name="notes" maxLength={1000} placeholder={tr("Chi tiết nghị quyết hoặc ghi chú")} />
                      </label>
                      <SearchChoice
                        base={base}
                        resource="departments"
                        label="Phòng ban"
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
                        label="Chức danh"
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
                          label="Quản lý trực tiếp"
                          value={manager}
                          initialLabel={detail.managerName}
                          onChange={setManager}
                        />
                      ) : (
                        <p className="muted">{tr("Chỉ Quản trị viên mới được điều chuyển người quản lý trực tiếp.")}</p>
                      )}
                      <div className="emp-actions">
                        <button className="primary" type="submit">
                          {busy ? 'Đang lưu…' : tr("Lưu điều chuyển")}
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
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="emp-timeline-badge">
                              {(h.eventType && workEventLabels[h.eventType] ? tr(workEventLabels[h.eventType]) : historyLabels[h.reason] ? tr(historyLabels[h.reason]) : h.reason)}
                            </span>
                            {h.title && <strong>{h.title}</strong>}
                          </div>
                          <p className="emp-timeline-desc">
                            <strong>{h.departmentName || tr("Chưa phân công phòng ban")}</strong> · {h.positionTitle || tr("Chưa có chức danh")}
                          </p>
                          <small className="muted">{tr('Lý do')}: {h.reason} · {tr('Quản lý trực tiếp')}: {h.managerName || tr("Chưa phân công")}</small>
                          {h.notes && <small style={{ color: '#686477' }}>{tr('Ghi chú')}: {h.notes}</small>}
                        </div>
                      </li>
                    ))}
                  {!sectionLoading && !sectionError && history?.items.length === 0 && (
                    <p className="muted">{tr("Chưa có mốc lịch sử công tác nào.")}</p>
                  )}
                </ol>
                {history && drawerPagination(historyPage, history.total, setHistoryPage)}
              </div>
            )}

            {tab === 'documents' && (
              <div className="emp-tab-panel">
                <div className="emp-card-header">
                  <h4>{tr("Tài liệu hồ sơ đính kèm")}</h4>
                  <small className="muted">{tr("Lưu trữ an toàn, phân quyền theo vai trò")}</small>
                </div>

                {canUploadAvatar && (
                  <form className="emp-doc-upload-box" onSubmit={handleDocumentUpload}>
                    <h4>{tr("Tải lên tài liệu mới")}</h4>
                    <div className="emp-form-grid">
                      <label className="field">
                        <span>{tr("Chọn tập tin")}</span>
                        <input
                          name="docFile"
                          type="file"
                          accept="image/jpeg,image/png,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xlsx,.csv"
                          required
                          disabled={docUploading || busy}
                        />
                      </label>
                      <label className="field">
                        <span>{tr("Phân loại tài liệu")}</span>
                        <select
                          value={docType}
                          onChange={e => setDocType(e.target.value as DocumentItem['documentType'])}
                          disabled={docUploading || busy}
                        >
                          {Object.entries(documentTypeLabels).map(([val, lbl]) => (
                            <option key={val} value={val}>
                              {tr(lbl)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field emp-span">
                        <span>{tr("Mô tả tài liệu (tùy chọn)")}</span>
                        <input
                          value={docDesc}
                          onChange={e => setDocDesc(e.target.value)}
                          placeholder={tr("Nhập ghi chú hoặc mô tả tài liệu")}
                          maxLength={500}
                          disabled={docUploading || busy}
                        />
                      </label>
                    </div>
                    <div className="emp-actions" style={{ marginTop: '12px' }}>
                      <button className="primary" type="submit" disabled={docUploading || busy}>
                        {docUploading ? tr("Đang tải lên…") : tr("Tải lên tài liệu")}
                      </button>
                    </div>
                  </form>
                )}

                {sectionLoading && <p role="status">{tr("Đang tải danh sách tài liệu…")}</p>}
                {sectionError && <p role="alert" className="notice error">{sectionError}</p>}

                <div className="emp-docs-list">
                  {!sectionLoading &&
                    documents.map(d => (
                      <article key={d.id} className="emp-doc-card">
                        <div className="emp-doc-info">
                          <div className="emp-doc-header">
                            <span className="emp-badge emp-badge-linked">
                              {documentTypeLabels[d.documentType] ? tr(documentTypeLabels[d.documentType]) : d.documentType}
                            </span>
                            <span className="emp-doc-name">{d.fileName}</span>
                          </div>
                          <div className="emp-doc-meta">
                            <span>{tr('Kích thước')}: {formatFileSize(d.fileSize)}</span> ·{' '}
                            <span>{tr('Ngày tải lên')}: {dateLabel(d.createdAt.slice(0, 10))}</span>
                          </div>
                          {d.description && <p className="emp-doc-desc">{d.description}</p>}
                        </div>
                        <div className="emp-doc-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => handleDownloadDoc(d)}
                            disabled={busy}
                          >
                            {tr("⬇ Tải về")}
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDeleteDoc(d)}
                              disabled={busy}
                            >
                              {tr("Xóa")}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  {!sectionLoading && !sectionError && documents.length === 0 && (
                    <p className="muted">{tr("Chưa có tài liệu đính kèm nào.")}</p>
                  )}
                </div>
              </div>
            )}

            {/* ---- PAY-001 Enhancement: Salary History Tab ---- */}
            {tab === 'salary' && (
              <div className="emp-tab-panel">
                <section className="emp-card">
                  <div className="emp-card-header">
                    <h4>{tr("Lịch sử mức lương")}</h4>
                  </div>
                  {sectionLoading && <p role="status">{tr("Đang tải lịch sử lương…")}</p>}
                  {sectionError && <p role="alert" className="notice error">{sectionError}</p>}
                  {!sectionLoading && !sectionError && salaryHistory && (
                    <>
                      {salaryHistory.items.length === 0 && (
                        <p className="muted">{tr("Chưa có hồ sơ lương nào.")}</p>
                      )}
                      {salaryHistory.items.map(sp => (
                        <article key={sp.id} className="emp-history-entry">
                          <div className="emp-history-meta">
                            <span className="emp-badge emp-badge-linked">
                              {sp.salaryMode === 'GROSS' ? 'Gross' : 'Net'}
                            </span>
                            <span className="emp-history-date">
                              {tr('Hiệu lực từ')}: <strong>{dateLabel(sp.effectiveFrom)}</strong>
                              {sp.effectiveTo ? ` → ${dateLabel(sp.effectiveTo)}` : tr(" (đang áp dụng)")}
                            </span>
                            <span className={'emp-badge ' + (sp.status === 'ACTIVE' ? 'emp-badge-active' : 'emp-badge-inactive')}>
                              {sp.status === 'ACTIVE' ? tr("Hiệu lực") : sp.status === 'DRAFT' ? tr("Nháp") : tr("Không hiệu lực")}
                            </span>
                          </div>
                          {sp.components.length > 0 && (
                            <table className="payroll-table" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  <th>{tr("Khoản mục")}</th>
                                  <th>{tr("Loại")}</th>
                                  <th style={{ textAlign: 'right' }}>{tr("Số tiền / %")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sp.components.map(c => (
                                  <tr key={c.componentId}>
                                    <td>{c.componentName}</td>
                                    <td>{c.type === 'ALLOWANCE' ? tr("Phụ cấp") : c.type === 'BONUS' ? tr("Thưởng") : c.type === 'DEDUCTION' ? tr("Khấu trừ") : tr("Lương cơ bản")}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      {c.percentage != null ? `${c.percentage}%` : Number(c.amount).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN') + ' ₫'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {sp.notes && <p className="muted" style={{ marginTop: 4, fontSize: '0.82rem' }}>{sp.notes}</p>}
                        </article>
                      ))}
                      {salaryHistory.total > 10 && (
                        <div className="payroll-pager">
                          <button disabled={salaryPage <= 1} onClick={() => setSalaryPage(p => p - 1)} type="button">{tr("‹ Trước")}</button>
                          <span>Trang {salaryPage}</span>
                          <button disabled={salaryPage * 10 >= salaryHistory.total} onClick={() => setSalaryPage(p => p + 1)} type="button">{tr("Sau ›")}</button>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}

            {/* ---- PAY-001 Enhancement: Social Insurance (BHXH) Tab ---- */}
            {tab === 'insurance' && (
              <div className="emp-tab-panel">
                <section className="emp-card">
                  <div className="emp-card-header">
                    <h4>{tr("Hồ sơ Bảo hiểm xã hội (BHXH)")}</h4>
                  </div>
                  {sectionLoading && <p role="status">{tr("Đang tải hồ sơ BHXH…")}</p>}
                  {sectionError && <p role="alert" className="notice error">{sectionError}</p>}
                  {!sectionLoading && !siProfile && !sectionError && (
                    <p className="muted">{tr("Chưa có thông tin BHXH được ghi nhận.")}</p>
                  )}
                  {!sectionLoading && siProfile && (
                    <>
                      <dl className="emp-dl">
                        <dt>{tr("Mã số BHXH")}</dt><dd><strong>{siProfile.siCode}</strong></dd>
                        {siProfile.hiCode && (<><dt>{tr("Mã BHYT")}</dt><dd>{siProfile.hiCode}</dd></>)}
                        <dt>{tr("Tên trên hồ sơ BHXH")}</dt><dd>{siProfile.insuredName}</dd>
                        <dt>{tr("Ngày tham gia")}</dt><dd>{dateLabel(siProfile.enrollmentDate)}</dd>
                        {siProfile.terminationDate && (<><dt>{tr("Ngày kết thúc")}</dt><dd>{dateLabel(siProfile.terminationDate)}</dd></>)}
                        <dt>{tr("Mức lương đóng BHXH")}</dt><dd>{Number(siProfile.siSalary).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')} {siProfile.currency}</dd>
                        <dt>{tr("Trạng thái")}</dt>
                        <dd>
                          <span className={'emp-badge ' + (siProfile.status === 'ACTIVE' ? 'emp-badge-active' : 'emp-badge-inactive')}>
                            {siProfile.status === 'ACTIVE' ? tr("Đang tham gia") : siProfile.status === 'SUSPENDED' ? tr("Tạm dừng") : tr("Đã kết thúc")}
                          </span>
                        </dd>
                        {siProfile.suspensionReason && (<><dt>{tr("Lý do tạm dừng")}</dt><dd className="muted">{siProfile.suspensionReason}</dd></>)}
                      </dl>

                      {siContributions.length > 0 && (
                        <>
                          <h5 style={{ marginTop: 16, marginBottom: 8 }}>{tr("Lịch sử đóng BHXH (12 tháng gần nhất)")}</h5>
                          <table className="payroll-table">
                            <thead>
                              <tr>
                                <th>{tr("Tháng")}</th>
                                <th style={{ textAlign: 'right' }}>{tr("Mức lương đóng")}</th>
                                <th style={{ textAlign: 'right' }}>{tr("NLĐ đóng")}</th>
                                <th style={{ textAlign: 'right' }}>{tr("NSDLĐ đóng")}</th>
                                <th>{tr("Trạng thái")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {siContributions.map(c => (
                                <tr key={c.contributionMonth}>
                                  <td>{c.contributionMonth.slice(0, 7)}</td>
                                  <td style={{ textAlign: 'right' }}>{Number(c.siSalary).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')}</td>
                                  <td style={{ textAlign: 'right' }}>{Number(c.employeeAmount).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')}</td>
                                  <td style={{ textAlign: 'right' }}>{Number(c.employerAmount).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')}</td>
                                  <td>
                                    <span className={'emp-badge ' + (c.status === 'CONFIRMED' ? 'emp-badge-active' : c.status === 'SKIPPED' ? 'emp-badge-inactive' : '')}>
                                      {c.status === 'CONFIRMED' ? tr("Đã xác nhận") : c.status === 'PENDING' ? tr("Chờ xác nhận") : c.status === 'ADJUSTED' ? tr("Điều chỉnh") : tr("Bỏ qua")}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="drawer-footer">
        <span>{tr("Chỉ hiển thị thông tin trong phạm vi quyền của bạn.")}</span>
        {busy && <span role="status">{tr("Đang lưu, vui lòng đợi…")}</span>}
      </footer>
    </dialog>,
    document.body
  );
}
