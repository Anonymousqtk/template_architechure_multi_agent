import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { errorText, request, type Profile } from './api';
import { Avatar } from './Avatar';
import { ProfileEditor, roleLabels } from './Users';
import { DashIcon } from './DashboardShell';

export function AccountProfile({ profile }: { profile: Profile }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(true);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarMessage, setAvatarMessage] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    setAvatarUrl(null);
    setAvatarLoading(true);
    setAvatarError('');
    setAvatarMessage('');
    request<{ avatarUrl: string | null }>('/api/auth/profile/avatar')
      .then(result => {
        if (active) {
          setAvatarUrl(result.avatarUrl);
        }
      })
      .catch(cause => {
        if (!active) return;
        setAvatarError(errorText(cause));
      })
      .finally(() => {
        if (active) setAvatarLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile.user.id]);

  function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setAvatarMessage('');
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setAvatarError('Chỉ chấp nhận ảnh JPG hoặc PNG.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAvatarError('Dung lượng ảnh không được vượt quá 10MB.');
      return;
    }
    setAvatarBusy(true);
    setAvatarError('');
    const reader = new FileReader();
    reader.onerror = () => {
      setAvatarError('Không thể đọc ảnh. Hãy thử chọn lại.');
      setAvatarBusy(false);
    };
    reader.onload = async () => {
      try {
        if (typeof reader.result !== 'string') {
          setAvatarError('Không thể đọc ảnh. Hãy thử chọn lại.');
          return;
        }
        const contentBase64 = reader.result.split(',')[1];
        if (!contentBase64) {
          setAvatarError('Không thể đọc ảnh. Hãy thử chọn lại.');
          return;
        }
        const result = await request<{ avatarUrl: string }>(
          '/api/auth/profile/avatar',
          { fileName: file.name, mimeType: file.type, contentBase64 },
          'POST'
        );
        setAvatarUrl(result.avatarUrl);
        setAvatarMessage('Đã cập nhật ảnh đại diện.');
      } catch (cause) {
        setAvatarError(errorText(cause));
      } finally {
        setAvatarBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="account-profile-page">
      <div className="dash-header-row">
        <div>
          <div className="eyebrow">TÀI KHOẢN CÁ NHÂN</div>
          <h1 className="dash-page-title">Hồ sơ & Tài khoản</h1>
          <p className="dash-page-subtitle">Quản lý thông tin cá nhân, tổ chức trực thuộc và thiết lập tài khoản.</p>
        </div>
      </div>

      <div className="account-profile-grid">
        {/* Left Column: Profile Card */}
        <div className="dash-card profile-summary-card">
          <div className="profile-card-hero">
            <div className="profile-avatar-editor" aria-busy={avatarBusy}>
              <Avatar src={avatarUrl} name={profile.user.fullName} className="dash-avatar profile-avatar-large" />
              {avatarLoading && <span className="profile-avatar-help">Đang tải ảnh đại diện…</span>}
              <button
                type="button"
                className="secondary profile-avatar-upload-btn"
                onClick={() => avatarInput.current?.click()}
                disabled={avatarBusy}
              >
                {avatarBusy ? 'Đang tải ảnh…' : 'Cập nhật ảnh'}
              </button>
              <input
                ref={avatarInput}
                className="profile-avatar-file-input"
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Chọn ảnh đại diện"
                onChange={handleAvatarSelect}
                hidden
              />
              <span className="profile-avatar-help">JPG hoặc PNG · tối đa 10MB</span>
            </div>
            <div className="profile-hero-info">
              <h2>{profile.user.fullName}</h2>
              <p className="muted">{profile.user.email}</p>
              <div className="profile-badges-strip">
                <span className="badge role-badge">{roleLabels[profile.organization.role]}</span>
                <span className="badge org-badge">{profile.organization.name}</span>
              </div>
            </div>
          </div>
          {avatarError && <p className="notice error" role="alert">{avatarError}</p>}
          {avatarMessage && <p className="notice success" role="status">{avatarMessage}</p>}

          <div className="profile-quick-stats">
            <div className="profile-stat-item">
              <span className="stat-label">Bảo mật MFA</span>
              <span className={`stat-value ${profile.security?.mfaEnabled ? 'text-green' : 'text-amber'}`}>
                {profile.security?.mfaEnabled ? '✓ Đã kích hoạt' : 'Chưa kích hoạt'}
              </span>
            </div>
            <div className="profile-stat-item">
              <span className="stat-label">Đơn vị trực thuộc</span>
              <span className="stat-value">{profile.organization.name}</span>
            </div>
            <div className="profile-stat-item">
              <span className="stat-label">Trạng thái tài khoản</span>
              <span className="stat-value text-green">✓ Đang hoạt động</span>
            </div>
          </div>

          <div className="profile-card-footer">
            <a href="/security" className="secondary button" style={{ width: '100%' }}>
              <DashIcon name="shield" /> Quản lý bảo mật & thiết bị →
            </a>
          </div>
        </div>

        {/* Right Column: Profile Editor & Details */}
        <div className="dash-card profile-settings-card">
          <div className="profile-card-section">
            <h2>Chi tiết tài khoản</h2>
            <dl className="profile-details">
              <div>
                <dt>Tổ chức</dt>
                <dd>{profile.organization.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{profile.user.email}</dd>
              </div>
              <div>
                <dt>Vai trò</dt>
                <dd>{roleLabels[profile.organization.role]}</dd>
              </div>
            </dl>
          </div>

          <div className="profile-card-section">
            <ProfileEditor profile={profile} />
          </div>
        </div>
      </div>
    </div>
  );
}
