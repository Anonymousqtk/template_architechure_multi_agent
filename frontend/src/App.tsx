import { BrandIcon } from './components/common/BrandIcon';
import { authShellEnglish } from './i18n/authShellMessages';
import { invitationEnglish } from './i18n/invitationMessages';
import { roleLabel } from './features/users/account-types';
import { Dashboard } from './pages/Dashboard/Dashboard';
import { LanguageSelector } from './i18n/LanguageSelector';
import { useTranslation } from './i18n';
import { DashboardShell } from './components/layout/DashboardShell';
import { AccountProfile } from './pages/Settings/AccountProfile';
import { AccountSecurity } from './pages/Settings/AccountSecurity';
import { SignInVerification } from './features/auth/components/SignInVerification';
import { PasskeySettings } from './features/auth/components/PasskeySettings';
import { SensitiveActionConfirmation } from './components/common/SensitiveActionConfirmation';
import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { UsersPanel, AuditPanel } from './pages/Users/Users';
import { OrganizationView } from './pages/Organization/OrganizationView';
import { Employees } from './pages/Employees/Employees';
import { Attendance } from './pages/Attendance/Attendance';
import { Payroll } from './pages/Payroll/Payroll';
import { Units } from './pages/Organization/Units';
import { ReportingCenter } from './pages/Reporting/ReportingCenter';
import { Avatar } from './components/common/Avatar';
import { EmployeeCardPage } from './pages/Employees/EmployeeCardPage';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ApiError,
  errorText,
  initialize,
  request,
  type DeliveryMode,
  type Invitation,
  type Profile,
} from './services/api';
import './assets/styles/workspace.css';
import './assets/styles/account-layout.css';

// Kept only in memory: remove credentials from browser history before any request.
const linkPath = window.location.pathname;
let linkToken = ['/invite/accept', '/register', '/reset-password'].includes(linkPath)
  ? new URLSearchParams(window.location.search).get('token') || ''
  : '';
if (linkToken) window.history.replaceState(null, '', linkPath);

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (error) ref.current?.focus();
  }, [error, children]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`notice ${error ? 'error' : 'success'}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <label className="field" htmlFor={name}>
      <span>{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={type === 'password' ? 128 : 254}
        required
      />
    </label>
  );
}
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

function Login({
  onLogin,
  inline = false,
  passkeys = false,
}: {
  onLogin: (profile: Profile) => void;
  inline?: boolean;
  passkeys?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(false);
  const attempt = useRef(0);
  const supportsPasskeys = passkeys && !inline && browserSupportsWebAuthn();
  useEffect(() => {
    if (!supportsPasskeys) return;
    const generation = ++attempt.current;
    async function autofill() {
      if (!(await browserSupportsWebAuthnAutofill()) || generation !== attempt.current) return;
      const optionsJSON = await request<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkeys/login/options',
        {},
      );
      if (generation !== attempt.current) return;
      const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
      if (generation !== attempt.current || active.current) return;
      active.current = true;
      setBusy(true);
      try {
        onLogin(
          await request<Profile>('/api/auth/passkeys/login/verify', {
            challenge: optionsJSON.challenge,
            response,
          }),
        );
      } catch (error) {
        setError(errorText(error));
      } finally {
        active.current = false;
        setBusy(false);
      }
    }
    void autofill().catch(() => {});
    return () => {
      ++attempt.current;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [onLogin, supportsPasskeys]);
  function begin() {
    if (active.current) return false;
    active.current = true;
    ++attempt.current;
    if (supportsPasskeys) WebAuthnAbortService.cancelCeremony();
    setBusy(true);
    setError('');
    return true;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    if (!begin()) return;
    try {
      onLogin(
        await request<Profile>('/api/auth/login', {
          email: data.get('email'),
          password: data.get('password'),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function signInWithPasskey() {
    if (!begin()) return;
    try {
      const optionsJSON = await request<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkeys/login/options',
        {},
      );
      const response = await startAuthentication({ optionsJSON });
      onLogin(
        await request<Profile>('/api/auth/passkeys/login/verify', {
          challenge: optionsJSON.challenge,
          response,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? errorText(e) : t('passkeyRetry'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">{t('welcomeBack')}</div>
      <h1>{inline ? t('confirmAccount') : t('signIn')}</h1>
      <p className="muted">{t('loginIntro')}</p>
      {error && <Notice error>{error}</Notice>}
      {supportsPasskeys && (
        <button
          className="secondary auth-passkey-button"
          type="button"
          disabled={busy}
          onClick={() => void signInWithPasskey()}
        >
          {t('signInPasskey')}
        </button>
      )}
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <Field
            label={t('workEmail')}
            name="email"
            type="email"
            autoComplete={supportsPasskeys ? 'username webauthn' : 'username'}
          />
          <Field
            label={t('password')}
            name="password"
            type="password"
            autoComplete="current-password"
          />
          {!inline && (
            <a className="forgot" href="/forgot-password">
              {t('forgotPassword')}
            </a>
          )}
          <button className="primary" type="submit">
            {busy ? t('signingIn') : t('signInArrow')}
          </button>
        </fieldset>
      </form>
      {!inline && (
        <div className="member-note">
          <span className="member-note-icon" aria-hidden="true">
            ↗
          </span>
          <p>
            <strong>{t('newMember')}</strong>
            {t('invitationHelp')}
          </p>
        </div>
      )}
    </>
  );
}
function Forgot() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/forgot-password', { email: data.get('email') });
      setMessage(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a className="back" href="/login">
        {t('backToLogin')}
      </a>
      <h1>{t('forgotPassword')}</h1>
      <p className="muted">{t('forgotPrompt')}</p>
      {Boolean(error) && <Notice error>{errorText(error)}</Notice>}
      {message && <Notice>{t('resetEmailSent')}</Notice>}
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <Field label={t('workEmail')} name="email" type="email" autoComplete="email" />
          <button className="primary">{busy ? t('processing') : t('requestLink')}</button>
        </fieldset>
      </form>
    </>
  );
}
function Reset() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState<unknown>(null),
    [mismatch, setMismatch] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    setError(null);
    setMismatch(false);
    if (data.get('password') !== data.get('confirmation')) {
      setMismatch(true);
      return;
    }
    setBusy(true);
    try {
      await request('/api/auth/reset-password', {
        token: linkToken,
        newPassword: data.get('password'),
      });
      linkToken = '';
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <>
        <h1>{t('passwordUpdated')}</h1>
        <Notice>{t('sessionsRevoked')}</Notice>
        <a className="button primary" href="/login">
          {t('goToLogin')}
        </a>
      </>
    );
  if (!linkToken)
    return (
      <>
        <h1>{t('missingResetLink')}</h1>
        <Notice error>{t('openResetLink')}</Notice>
        <a href="/forgot-password">{t('requestNewLink')}</a>
      </>
    );
  return (
    <>
      <div className="eyebrow">{t('protectAccount')}</div>
      <h1>{t('resetPassword')}</h1>
      <p className="muted">{t('passwordGuidance')}</p>
      {(Boolean(error) || mismatch) && (
        <Notice error>{mismatch ? t('passwordMismatch') : errorText(error)}</Notice>
      )}
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <Field
            label={t('newPassword')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
          />
          <Field
            label={t('confirmPassword')}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
          />
          <button className="primary">{busy ? t('updating') : t('saveNewPassword')}</button>
        </fieldset>
      </form>
    </>
  );
}
function Accept({
  profile,
  onLogin,
}: {
  profile: Profile | null;
  onLogin: (profile: Profile) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('checking'),
    [existing, setExisting] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!linkToken) {
      setStatus('invalid');
      return;
    }
    let alive = true;
    request<{ status: string }>(
      `/api/auth/invitations/validate?token=${encodeURIComponent(linkToken)}`,
    )
      .then((r) => {
        if (alive) setStatus(r.status);
      })
      .catch((e) => {
        if (alive) {
          setError(e);
          setStatus('error');
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    setBusy(true);
    setError('');
    try {
      await request(
        '/api/auth/invitations/accept',
        profile
          ? { token: linkToken }
          : { token: linkToken, fullName: data.get('fullName'), password: data.get('password') },
      );
      linkToken = '';
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <>
        <h1>{t('welcome')}</h1>
        <Notice>{t('invitationAccepted')}</Notice>
        <a className="button primary" href="/login">
          {t('signInArrow')}
        </a>
      </>
    );
  if (status === 'checking') return <p role="status">{t('checkingInvitation')}</p>;
  if (status !== 'valid')
    return (
      <>
        <h1>{t('invitationUnavailable')}</h1>
        <Notice error>{error ? errorText(error) : t('invalidInvitation')}</Notice>
        <a href="/login">{t('returnToLogin')}</a>
      </>
    );
  if (existing && !profile)
    return (
      <>
        <Login inline onLogin={onLogin} />
        <button className="text-button" onClick={() => setExisting(false)}>
          {t('noAccount')}
        </button>
      </>
    );
  return (
    <>
      <div className="eyebrow">{t('invitationHeading')}</div>
      <h1>{t('newStart')}</h1>
      <p className="muted">{t('invitationScope')}</p>
      {Boolean(error) && <Notice error>{errorText(error)}</Notice>}
      {profile && (
        <Notice>
          {t('confirmingAs')} {profile.user.email}. {t('passwordRetained')}
        </Notice>
      )}
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          {!profile && (
            <>
              <Field label={t('fullName')} name="fullName" autoComplete="name" />
              <Field
                label={t('createPassword')}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
              />
            </>
          )}
          <button className="primary">{busy ? t('confirming') : t('acceptInvitation')}</button>
        </fieldset>
      </form>
      {!profile && (
        <button className="text-button" onClick={() => setExisting(true)}>
          {t('hasAccount')}
        </button>
      )}
    </>
  );
}

function Invitations({ profile }: { profile: Profile }) {
  const { locale } = useTranslation();
  const tr = (text: string) => (locale === 'en' ? (invitationEnglish[text] ?? text) : text);
  const [items, setItems] = useState<Invitation[]>([]),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [message, setMessage] = useState(false);
  const base = `/api/organizations/${profile.organization.id}/invitations`;
  async function load(p: number) {
    const data = await request<{ items: Invitation[] }>(`${base}?page=${p}&limit=10`);
    setItems(data.items);
  }
  useEffect(() => {
    if (!profile.permissions.invite) return;
    let alive = true;
    setBusy(true);
    request<{ items: Invitation[] }>(`${base}?page=${page}&limit=10`)
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch((e) => {
        if (alive) setError(e);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [base, page, profile.permissions.invite]);
  async function action(path: string, body: unknown, form?: HTMLFormElement) {
    setBusy(true);
    setError(null);
    setMessage(false);
    try {
      await request(path, body);
      form?.reset();
      setMessage(true);
      await load(page);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget,
      data = values(event);
    void action(base, { email: data.get('email'), role: data.get('role') }, form);
  }
  if (!profile.permissions.invite)
    return (
      <>
        <h1>{tr('Không có quyền truy cập')}</h1>
        <Notice error>{tr('Chỉ HR và quản trị viên được quản lý lời mời.')}</Notice>
        <a href="/app">{tr('Về không gian làm việc')}</a>
      </>
    );
  return (
    <>
      <div className="eyebrow">{tr('QUẢN LÝ THÀNH VIÊN')}</div>
      <h1>{tr('Lời mời tham gia')}</h1>
      <p className="muted">
        {locale === 'en'
          ? `Invite colleagues to ${profile.organization.name}. The link is valid for 48 hours.`
          : `Mời đồng nghiệp vào ${profile.organization.name}. Liên kết có hiệu lực trong 48 giờ.`}
      </p>
      {Boolean(error) && <Notice error>{errorText(error)}</Notice>}
      {message && (
        <Notice>{tr('Yêu cầu đã được xử lý. Kiểm tra trạng thái lời mời bên dưới.')}</Notice>
      )}
      <form className="invite-form" onSubmit={invite} aria-busy={busy}>
        <fieldset disabled={busy}>
          <Field label={tr('Email công việc')} name="email" type="email" autoComplete="off" />
          <label className="field" htmlFor="role">
            <span>{tr('Vai trò')}</span>
            <select id="role" name="role">
              <option value="EMPLOYEE">{tr('Nhân viên')}</option>
              {profile.permissions.grantHR && <option value="HR">{tr('Nhân sự')}</option>}
            </select>
          </label>
          <button className="primary">{busy ? tr('Đang xử lý…') : tr('Gửi lời mời')}</button>
        </fieldset>
      </form>
      <div className="table-wrap">
        <table>
          <caption>
            {locale === 'en' ? `Invitations · Page ${page}` : `Danh sách lời mời · Trang ${page}`}
          </caption>
          <thead>
            <tr>
              <th>{tr('Email / vai trò')}</th>
              <th>{tr('Trạng thái')}</th>
              <th>{tr('Gửi thư')}</th>
              <th>{tr('Thao tác')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const pending = !item.consumedAt && !item.revokedAt;
              const status = item.consumedAt
                ? tr('Đã tham gia')
                : item.revokedAt
                  ? tr('Đã thu hồi')
                  : new Date(item.expiresAt).getTime() <= Date.now()
                    ? tr('Hết hạn')
                    : tr('Đang chờ');
              return (
                <tr key={item.id}>
                  <td>
                    <div className="invitation-list-identity">
                      <Avatar
                        src={item.avatarUrl}
                        name={item.email}
                        className="invitation-list-avatar"
                      />
                      <div>
                        <strong>{item.email}</strong>
                        <small>{roleLabel(item.role, locale)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge">{status}</span>
                    <small>
                      {locale === 'en' ? 'Expires: ' : 'H\u1ea1n: '}
                      {new Date(item.expiresAt).toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN')}
                    </small>
                  </td>
                  <td>
                    {item.deliveryStatus === 'SENT'
                      ? tr('Đã gửi')
                      : item.deliveryStatus === 'FAILED'
                        ? tr('Gửi thất bại')
                        : 'DEV_ONLY'}
                  </td>
                  <td>
                    {pending && (
                      <div className="row-actions">
                        <button
                          disabled={busy}
                          onClick={() => void action(`${base}/${item.id}/resend`, {})}
                        >
                          {tr('Gửi lại')}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void action(`${base}/${item.id}/revoke`, {})}
                        >
                          {tr('Thu hồi')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={4}>{busy ? tr('Đang tải…') : tr('Chưa có lời mời ở trang này.')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="pagination" aria-label={tr('Phân trang lời mời')}>
        <button disabled={page === 1 || busy} onClick={() => setPage((p) => p - 1)}>
          {tr('← Trước')}
        </button>
        <span>
          {locale === 'en' ? 'Page' : 'Trang'} {page}
        </span>
        <button disabled={items.length < 10 || busy} onClick={() => setPage((p) => p + 1)}>
          {tr('Sau →')}
        </button>
      </nav>
    </>
  );
}

export default function App() {
  const { locale, t } = useTranslation();
  const shellText = (text: string) => (locale === 'en' ? (authShellEnglish[text] ?? text) : text);
  const [ready, setReady] = useState(false),
    [profile, setProfile] = useState<Profile | null>(null),
    [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('DEV_ONLY'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const [passkeyOffer, setPasskeyOffer] = useState(false);
  const [route, setRoute] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const path = route.pathname;
  useEffect(() => {
    let alive = true;
    const syncRoute = () =>
      setRoute({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', syncRoute);
    initialize()
      .then(async (config) => {
        if (!alive) return;
        setDeliveryMode(config.deliveryMode);
        setPasskeys(Boolean(config.passkeysAvailable));
        try {
          const result = await request<Profile>('/api/auth/me');
          if (alive) {
            if (
              ['/', '/login'].includes(window.location.pathname) &&
              (!result.security?.mfaRequired || result.security.mfaVerified)
            ) {
              window.history.replaceState(null, '', '/app');
              setRoute({ pathname: '/app', search: '' });
            }
            setProfile(result);
          }
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }
        if (alive) setReady(true);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);
  const navigate = (to: string) => {
    const destination = new URL(to, window.location.href);
    const relative = destination.pathname + destination.search + destination.hash;
    window.history.pushState(null, '', relative);
    setRoute({ pathname: destination.pathname, search: destination.search });
  };
  const entryPage = ['/login', '/', '/invite/accept', '/register'].includes(path);
  const destination = entryPage ? '/app' : path + route.search;
  function onLogin(result: Profile) {
    setProfile(result);
    if (
      (!result.security?.mfaRequired || result.security.mfaVerified) &&
      ['/login', '/'].includes(path)
    )
      navigate(destination);
  }
  async function completeVerification() {
    const result = await request<Profile>('/api/auth/me');
    const offerKey = 'managerhr-passkey-offer:' + result.user.id;
    if (
      passkeys &&
      browserSupportsWebAuthn() &&
      ['ADMIN', 'HR'].includes(result.organization.role)
    ) {
      try {
        if (!localStorage.getItem(offerKey)) {
          const registered = await request<{ items: unknown[] }>('/api/auth/passkeys');
          if (!registered.items.length) setPasskeyOffer(true);
        }
      } catch {
        // The optional enrollment offer must not prevent sign-in.
      }
    }
    setProfile(result);
    if (['/', '/login', '/security'].includes(path)) navigate('/app');
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/logout', {});
      window.location.assign('/login');
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  const limited = Boolean(profile?.security?.mfaRequired && !profile?.security?.mfaVerified);
  const verifying =
    limited &&
    Boolean(profile?.security?.mfaEnabled) &&
    !['/forgot-password', '/reset-password'].includes(path);
  const login = <Login onLogin={onLogin} passkeys={passkeys} />;
  const profileView =
    path === '/app' && new URLSearchParams(route.search).get('view') === 'profile';
  const personal = path === '/app' || path === '/security';
  const workspace = Boolean(
    ready && profile && !limited && !passkeyOffer && (personal || path.startsWith('/admin/')),
  );
  const organizationHome = profile?.permissions.readUsers
    ? '/admin/users'
    : profile?.permissions.invite
      ? '/admin/invitations'
      : profile?.permissions.viewAudit
        ? '/admin/audit'
        : null;

  if (path === '/employee-card') {
    return <EmployeeCardPage profile={profile} onNavigate={navigate} />;
  }

  let content: ReactNode;
  if (!ready) {
    if (error)
      content = (
        <>
          <Notice error>{error}</Notice>
          <button onClick={() => window.location.reload()}>{t('reloadPage')}</button>
        </>
      );
    else if (path.startsWith('/admin/') || path === '/app' || path === '/security')
      return (
        <div className="workspace-loading-splash" role="status" aria-live="polite">
          <div className="workspace-loading-inner">
            <span className="dash-brand-mark" aria-hidden="true">
              <BrandIcon />
            </span>
            <div className="workspace-loading-text">
              <strong>ManagerHR</strong>
              <span>{t('syncingWorkspace')}</span>
            </div>
          </div>
        </div>
      );
    else content = <p role="status">{t('connectingSecurely')}</p>;
  } else if (profile && passkeyOffer)
    content = (
      <PasskeySettings
        onContinue={() => {
          try {
            localStorage.setItem('managerhr-passkey-offer:' + profile.user.id, 'seen');
          } catch {
            /* Storage can be unavailable. */
          }
          setPasskeyOffer(false);
        }}
      />
    );
  else if (profile && limited && !['/forgot-password', '/reset-password'].includes(path))
    content = profile.security?.mfaEnabled ? (
      <SignInVerification
        email={profile.user.email}
        onVerified={completeVerification}
        onCancel={() => void logout()}
      />
    ) : (
      <AccountSecurity profile={profile} onEnrollmentComplete={completeVerification} />
    );
  else if (profile && path === '/security')
    content = (
      <div className="account-settings-layout">
        <div className="account-settings-main">
          <AccountSecurity profile={profile} />
        </div>
        {passkeys &&
          profile.security?.mfaEnabled &&
          profile.security.mfaVerified &&
          ['ADMIN', 'HR'].includes(profile.organization.role) && <PasskeySettings />}
      </div>
    );
  else if (path === '/security') content = login;
  else if (path === '/forgot-password') content = <Forgot />;
  else if (path === '/reset-password') content = <Reset />;
  else if (['/invite/accept', '/register'].includes(path))
    content = <Accept profile={profile} onLogin={onLogin} />;
  else if (path === '/admin/invitations')
    content = profile ? (
      <Invitations profile={profile} />
    ) : (
      <>
        <Notice error>{t('signInForInvitations')}</Notice>
        {login}
      </>
    );
  else if (path === '/admin/users' || path === '/admin/audit')
    content = profile ? (
      path === '/admin/users' ? (
        <UsersPanel profile={profile} />
      ) : (
        <AuditPanel profile={profile} />
      )
    ) : (
      login
    );
  else if (path === '/admin/org-chart')
    content = profile ? (
      <OrganizationView profile={profile} activeTab="org-chart" onNavigate={navigate} />
    ) : (
      login
    );
  else if (path === '/admin/departments')
    content = profile ? (
      <OrganizationView profile={profile} activeTab="departments" onNavigate={navigate} />
    ) : (
      login
    );
  else if (path === '/admin/positions')
    content = profile ? (
      <OrganizationView profile={profile} activeTab="positions" onNavigate={navigate} />
    ) : (
      login
    );
  else if (path === '/admin/organization')
    content = profile ? (
      <OrganizationView profile={profile} activeTab="organization" onNavigate={navigate} />
    ) : (
      login
    );
  else if (path === '/admin/employees') content = profile ? <Employees profile={profile} /> : login;
  else if (path === '/admin/attendance')
    content = profile ? <Attendance key="attendance" profile={profile} /> : login;
  else if (path === '/admin/work-shifts')
    content = profile ? <Attendance key="shifts" profile={profile} view="shifts" /> : login;
  else if (path === '/admin/leave-types')
    content = profile ? (
      <Attendance key="leave-types" profile={profile} view="leave-types" />
    ) : (
      login
    );
  else if (path === '/admin/attendance-policy')
    content = profile ? <Attendance key="policy" profile={profile} view="policy" /> : login;
  else if (path === '/admin/payroll')
    content = profile ? <Payroll key="payroll" profile={profile} view="periods" /> : login;
  else if (path === '/admin/salary-components')
    content = profile ? <Payroll key="components" profile={profile} view="components" /> : login;
  else if (path === '/admin/payroll-accounting')
    content = profile ? <Payroll key="accounting" profile={profile} view="accounting" /> : login;
  else if (path === '/admin/my-payslips')
    content = profile ? <Payroll key="my-slips" profile={profile} view="my-slips" /> : login;
  else if (path === '/admin/reports')
    content = profile ? <ReportingCenter profile={profile} onNavigate={navigate} /> : login;
  else if (path === '/admin/units')
    content = profile ? (
      <Units
        onSelected={(result) => {
          setProfile(result);
          navigate('/app');
        }}
      />
    ) : (
      login
    );
  else if (path === '/app')
    content = profile ? (
      profileView ? (
        <AccountProfile profile={profile} />
      ) : (
        <Dashboard profile={profile} />
      )
    ) : (
      <>
        <Notice error>{shellText('Phiên đăng nhập không còn hiệu lực.')}</Notice>
        {login}
      </>
    );
  else if (path === '/login' || path === '/') content = login;
  else
    content = (
      <>
        <h1>{shellText('Không tìm thấy trang')}</h1>
        <a href="/login">{shellText('Về trang đăng nhập')}</a>
      </>
    );
  if (workspace && profile)
    return (
      <DashboardShell
        profile={profile}
        path={path}
        profileView={profileView}
        busy={busy}
        onLogout={() => void logout()}
        onNavigate={navigate}
      >
        {deliveryMode === 'DEV_ONLY' && path === '/admin/invitations' && (
          <div className="dev-warning" role="status">
            <strong>{shellText('DEV_ONLY · Chưa cấu hình gửi email')}</strong>
            <span>{shellText('Không có email thực tế được gửi trong chế độ này.')}</span>
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
        {content}
        <SensitiveActionConfirmation useCode={Boolean(profile.security?.mfaEnabled)} />
      </DashboardShell>
    );
  return (
    <div className={`layout ${limited || passkeyOffer ? 'verification-layout' : ''}`}>
      <a className="skip-link" href="#main-content">
        {shellText('Đến nội dung chính')}
      </a>
      <aside className="brand-panel">
        <a
          className="brand"
          href={profile ? '/app' : '/login'}
          aria-label={shellText('ManagerHR trang chủ')}
        >
          <span className="brand-mark" aria-hidden="true">
            <BrandIcon />
          </span>
          Manager<span>HR</span>
        </a>
        <div className="brand-story">
          <span className="hero-tag">
            <span aria-hidden="true">✦</span> {shellText('NỀN TẢNG QUẢN TRỊ NHÂN SỰ')}
          </span>
          <h2>
            {shellText('Quản lý nhân sự.')}
            <br />
            <span>{shellText('Kết nối đội ngũ.')}</span>
          </h2>
          <p>
            {shellText('Mọi con người, một không gian chung.')}
            <br />
            {shellText('Đơn giản hơn mỗi ngày cùng ManagerHR.')}
          </p>
          <div className="workspace-preview" aria-hidden="true">
            <div className="preview-top">
              <span className="preview-symbol">M</span>
              <strong>{shellText('Không gian đội ngũ')}</strong>
              <span className="preview-dots">•••</span>
            </div>
            <div className="preview-body">
              <div className="preview-greeting">
                <span>{shellText('CÙNG NHAU PHÁT TRIỂN')}</span>
                <strong>{shellText('Một đội ngũ. Nhiều khả năng.')}</strong>
              </div>
              <div className="preview-people">
                <span className="avatar avatar-blue">AN</span>
                <span className="avatar avatar-purple">LH</span>
                <span className="avatar avatar-teal">MT</span>
                <span className="avatar avatar-peach">HK</span>
                <span className="avatar avatar-more">+</span>
                <span className="connection-line" />
              </div>
              <div className="preview-flow">
                <span className="flow-check">✓</span>
                <div>
                  <strong>{shellText('Kết nối đúng người')}</strong>
                  <small>{shellText('Lời mời riêng · Vai trò rõ ràng')}</small>
                </div>
                <span className="flow-arrow">↗</span>
              </div>
              <div className="preview-bottom">
                <span>
                  <i /> {shellText('Không gian làm việc gắn kết')}
                </span>
                <span>{shellText('Minh họa giao diện')}</span>
              </div>
            </div>
          </div>
          <div className="hero-benefits">
            <span>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="m10 2 6 2v5c0 4-6 8-6 8s-6-4-6-8V4l6-2Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m7 9 2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>{' '}
              {shellText('Truy cập theo lời mời')}
            </span>
            <span>
              <span className="benefit-dot" /> {shellText('Quản lý theo vai trò')}
            </span>
          </div>
        </div>
        <small className="brand-footer">
          {shellText('Dành cho con người. Đồng hành cùng tổ chức.')}
        </small>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar">
          <LanguageSelector />
          <span className="security-label">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect
                x="5"
                y="8"
                width="10"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M7 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="12" r="1" fill="currentColor" />
            </svg>{' '}
            {shellText('Cổng thông tin nội bộ')}
          </span>
          {profile && !verifying && (
            <nav className="account-nav" aria-label={shellText('Tài khoản')}>
              {!limited && (
                <>
                  <a href="/app" aria-current={personal ? 'page' : undefined}>
                    {shellText('Tài khoản')}
                  </a>
                  {organizationHome && (
                    <a
                      href={organizationHome}
                      aria-current={path.startsWith('/admin/') ? 'page' : undefined}
                    >
                      {profile.organization.role === 'MANAGER'
                        ? shellText('Nhóm của tôi')
                        : shellText('Tổ chức')}
                    </a>
                  )}
                </>
              )}
              <button onClick={() => void logout()} disabled={busy}>
                {shellText('Đăng xuất')}
              </button>
            </nav>
          )}
        </header>
        <div className="content">
          {ready && deliveryMode === 'DEV_ONLY' && (
            <div className="dev-warning" role="status">
              <strong>{shellText('DEV_ONLY · Chưa cấu hình gửi email')}</strong>
              <span>{shellText('Không có email thực tế được gửi trong chế độ này.')}</span>
            </div>
          )}
          {ready && error && <Notice error>{error}</Notice>}
          {content}
        </div>
        <footer className="main-footer">
          <span>{shellText('Chỉ dành cho thành viên được tổ chức mời tham gia.')}</span>
          <span>© {new Date().getFullYear()} ManagerHR</span>
        </footer>
      </main>
    </div>
  );
}
