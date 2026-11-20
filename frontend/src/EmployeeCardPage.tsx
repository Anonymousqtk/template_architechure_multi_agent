import { useEffect, useState } from 'react';
import type { Profile } from './api';
import './employees.css';

interface PublicEmployee {
  id: string;
  organizationId: string;
  organizationName: string;
  employeeCode: string;
  fullName: string;
  avatarUrl: string | null;
  hireDate: string;
  employmentStatus: string;
  departmentName: string | null;
  positionTitle: string | null;
  managerName: string | null;
  phone: string | null;
  personalEmail: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
}

type Props = {
  profile?: Profile | null;
  onNavigate?: (path: string) => void;
};

export function EmployeeCardPage({ profile, onNavigate }: Props) {
  const [data, setData] = useState<PublicEmployee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org');
    const code = params.get('code');

    if (!orgId || !code) {
      setError('Thiếu thông tin tổ chức hoặc mã nhân viên để hiển thị thẻ.');
      setLoading(false);
      return;
    }

    let active = true;
    fetch(`/api/public/organizations/${encodeURIComponent(orgId)}/employees/${encodeURIComponent(code)}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.code === 'EMPLOYEE_NOT_FOUND' ? 'Không tìm thấy hồ sơ nhân viên này.' : 'Không thể tải thẻ nhân viên.');
        }
        return res.json();
      })
      .then(json => {
        if (active) {
          setData(json.employee);
          setError('');
        }
      })
      .catch(err => {
        if (active) setError(err.message || 'Lỗi kết nối máy chủ.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const initials = data?.fullName
    ? data.fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map(p => p[0])
        .join('')
        .toUpperCase()
    : 'NV';

  const hireDateFormatted = data?.hireDate
    ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(new Date(data.hireDate + 'T00:00:00Z'))
    : null;

  async function copyToClipboard(text: string, type: 'account' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'account') {
        setCopiedAccount(true);
        setTimeout(() => setCopiedAccount(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="emp-card-page-layout">
      <header className="emp-card-page-topbar">
        <a href="/login" className="emp-card-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M4 18V6l8 8 8-8v12" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Manager<strong>HR</strong>
        </a>
        {profile && onNavigate && (
          <button
            type="button"
            className="secondary"
            onClick={() => onNavigate('/admin/employees')}
          >
            Quay lại hệ thống
          </button>
        )}
      </header>

      <main className="emp-card-main-container">
        {loading && (
          <div className="emp-card-loading" role="status">
            <div className="loading-spinner" />
            <p>Đang tải thông tin thẻ nhân viên…</p>
          </div>
        )}

        {error && !loading && (
          <div className="emp-card-error-box" role="alert">
            <div className="emp-card-error-icon">⚠️</div>
            <h2>Không thể hiển thị thẻ nhân viên</h2>
            <p>{error}</p>
            <a href="/login" className="primary" style={{ display: 'inline-block', marginTop: '16px' }}>
              Về trang đăng nhập
            </a>
          </div>
        )}

        {data && !loading && (
          <article className="digital-emp-card" aria-label={`Thẻ nhân viên của ${data.fullName}`}>
            <div className="digital-card-banner">
              <div className="digital-card-org">
                <span className="digital-verified-badge" title="Đã xác thực bởi hệ thống ManagerHR">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  Xác thực chính thức
                </span>
                <span className="digital-org-name">{data.organizationName}</span>
              </div>
            </div>

            <div className="digital-card-profile-row">
              <div className="digital-card-avatar-wrap">
                {data.avatarUrl ? (
                  <img src={data.avatarUrl} alt={data.fullName} className="digital-card-avatar" />
                ) : (
                  <div className="digital-card-avatar-fallback">{initials}</div>
                )}
              </div>
              <div className="digital-card-name-group">
                <h1 className="digital-emp-name">{data.fullName}</h1>
                <div className="digital-emp-badges">
                  <span className="emp-badge emp-badge-linked">{data.employeeCode}</span>
                  <span className={`emp-badge emp-badge-${data.employmentStatus.toLowerCase()}`}>
                    {data.employmentStatus === 'ACTIVE'
                      ? 'Đang làm việc'
                      : data.employmentStatus === 'ON_LEAVE'
                      ? 'Tạm nghỉ'
                      : 'Đã nghỉ việc'}
                  </span>
                </div>
              </div>
            </div>

            <div className="digital-card-body">
              <div className="digital-info-grid">
                <div className="digital-info-item">
                  <span className="digital-label">Vị trí / Chức danh</span>
                  <strong className="digital-val">{data.positionTitle || 'Chưa phân công'}</strong>
                </div>
                <div className="digital-info-item">
                  <span className="digital-label">Phòng ban</span>
                  <strong className="digital-val">{data.departmentName || 'Chưa phân công'}</strong>
                </div>
                {hireDateFormatted && (
                  <div className="digital-info-item">
                    <span className="digital-label">Ngày gia nhập</span>
                    <span className="digital-val">{hireDateFormatted}</span>
                  </div>
                )}
                {data.phone && (
                  <div className="digital-info-item">
                    <span className="digital-label">Số điện thoại</span>
                    <a href={`tel:${data.phone}`} className="digital-link">
                      {data.phone}
                    </a>
                  </div>
                )}
                {data.personalEmail && (
                  <div className="digital-info-item">
                    <span className="digital-label">Email liên hệ</span>
                    <a href={`mailto:${data.personalEmail}`} className="digital-link">
                      {data.personalEmail}
                    </a>
                  </div>
                )}
              </div>

              {/* Thông tin tài khoản ngân hàng */}
              <div className="digital-bank-section">
                <div className="digital-bank-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                  <h3>Thông tin tài khoản ngân hàng</h3>
                </div>

                {data.bankAccountNumber || data.bankName ? (
                  <div className="digital-bank-card">
                    <div className="digital-bank-row">
                      <span className="bank-sublabel">Ngân hàng:</span>
                      <strong className="bank-strong">{data.bankName || 'Chưa cập nhật tên ngân hàng'}</strong>
                    </div>

                    <div className="digital-bank-row digital-bank-acc">
                      <span className="bank-sublabel">Số tài khoản:</span>
                      <div className="bank-acc-copy-wrap">
                        <code className="bank-number">{data.bankAccountNumber || '—'}</code>
                        {data.bankAccountNumber && (
                          <button
                            type="button"
                            className="bank-copy-btn"
                            onClick={() => copyToClipboard(data.bankAccountNumber!, 'account')}
                            aria-label="Sao chép số tài khoản"
                          >
                            {copiedAccount ? '✓ Đã sao chép' : 'Sao chép'}
                          </button>
                        )}
                      </div>
                    </div>

                    {data.bankAccountName && (
                      <div className="digital-bank-row">
                        <span className="bank-sublabel">Chủ tài khoản:</span>
                        <span className="bank-holder-name">{data.bankAccountName.toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted digital-bank-empty">Chưa có thông tin tài khoản ngân hàng được ghi nhận.</p>
                )}
              </div>
            </div>

            <footer className="digital-card-footer">
              <button
                type="button"
                className="secondary digital-btn-copy"
                onClick={() => copyToClipboard(window.location.href, 'link')}
              >
                {copiedLink ? '✓ Đã sao chép liên kết thẻ' : 'Sao chép liên kết thẻ'}
              </button>
              <span className="digital-powered-by">
                Được bảo đảm bởi nền tảng quản trị nhân sự ManagerHR
              </span>
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}
