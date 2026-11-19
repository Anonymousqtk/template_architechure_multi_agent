import { Dashboard } from './Dashboard';
import { DashboardShell } from './DashboardShell';
import { AccountProfile } from './AccountProfile';
import { AccountSecurity } from './AccountSecurity';
import { UsersPanel, AuditPanel } from './Users';
import { OrganizationView } from './OrganizationView';
import { Employees } from './Employees';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, errorText, initialize, request, type DeliveryMode, type Invitation, type Profile } from './api';

// Kept only in memory: remove credentials from browser history before any request.
const linkPath = window.location.pathname;
let linkToken = ['/invite/accept', '/register', '/reset-password'].includes(linkPath)
  ? new URLSearchParams(window.location.search).get('token') || '' : '';
if (linkToken) window.history.replaceState(null, '', linkPath);
const roleName: Record<string, string> = { MANAGER: 'Quản lý', ADMIN: 'Quản trị viên', HR: 'Nhân sự', EMPLOYEE: 'Nhân viên' };

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (error) ref.current?.focus(); }, [error, children]);
  return <div ref={ref} tabIndex={-1} className={`notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
function Field({ label, name, type = 'text', autoComplete, minLength }: { label: string; name: string; type?: string; autoComplete?: string; minLength?: number }) {
  return <label className="field" htmlFor={name}><span>{label}</span><input id={name} name={name} type={type} autoComplete={autoComplete} minLength={minLength} maxLength={type === 'password' ? 128 : 254} required /></label>;
}
function values(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget); }

function Login({ onLogin, inline = false }: { onLogin: (profile: Profile) => void; inline?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event); setBusy(true); setError('');
    try { onLogin(await request<Profile>('/api/auth/login', { email: data.get('email'), password: data.get('password') })); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <><div className="eyebrow">CHÀO MỪNG TRỞ LẠI</div><h1>{inline ? 'Xác nhận tài khoản của bạn' : 'Đăng nhập'}</h1><p className="muted">Một ngày làm việc hiệu quả bắt đầu từ đây.</p>
    {error && <Notice error>{error}</Notice>}
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}>
      <Field label="Email công việc" name="email" type="email" autoComplete="username" />
      <Field label="Mật khẩu" name="password" type="password" autoComplete="current-password" />
      {!inline && <a className="forgot" href="/forgot-password">Quên mật khẩu?</a>}
      <button className="primary" type="submit">{busy ? 'Đang đăng nhập…' : 'Đăng nhập →'}</button>
    </fieldset></form>
    {!inline && <div className="member-note"><span className="member-note-icon" aria-hidden="true">↗</span><p><strong>Bạn là thành viên mới?</strong>Hãy mở liên kết lời mời từ HR hoặc quản trị viên để tham gia.</p></div>}</>;
}
function Forgot() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event); setBusy(true); setError('');
    try { await request('/api/auth/forgot-password', { email: data.get('email') }); setMessage('Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi qua email.'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <><a className="back" href="/login">← Đăng nhập</a><h1>Quên mật khẩu?</h1><p className="muted">Nhập email công việc để yêu cầu liên kết đặt lại mật khẩu.</p>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}><Field label="Email công việc" name="email" type="email" autoComplete="email" /><button className="primary">{busy ? 'Đang xử lý…' : 'Yêu cầu liên kết'}</button></fieldset></form></>;
}
function Reset() {
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event); setError('');
    if (data.get('password') !== data.get('confirmation')) { setError('Hai mật khẩu chưa trùng khớp.'); return; }
    setBusy(true);
    try { await request('/api/auth/reset-password', { token: linkToken, newPassword: data.get('password') }); linkToken = ''; setDone(true); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  if (done) return <><h1>Mật khẩu đã được cập nhật</h1><Notice>Các phiên đăng nhập trước đã bị thu hồi. Hãy đăng nhập bằng mật khẩu mới.</Notice><a className="button primary" href="/login">Đến trang đăng nhập →</a></>;
  if (!linkToken) return <><h1>Thiếu liên kết đặt lại</h1><Notice error>Hãy mở liên kết trong email hoặc yêu cầu một liên kết mới.</Notice><a href="/forgot-password">Yêu cầu liên kết mới</a></>;
  return <><div className="eyebrow">BẢO VỆ TÀI KHOẢN</div><h1>Đặt lại mật khẩu</h1><p className="muted">Dùng từ 12 đến 128 ký tự. Không chia sẻ mật khẩu với bất kỳ ai.</p>{error && <Notice error>{error}</Notice>}
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}><Field label="Mật khẩu mới" name="password" type="password" autoComplete="new-password" minLength={12} /><Field label="Nhập lại mật khẩu" name="confirmation" type="password" autoComplete="new-password" minLength={12} /><button className="primary">{busy ? 'Đang cập nhật…' : 'Lưu mật khẩu mới'}</button></fieldset></form></>;
}
function Accept({ profile, onLogin }: { profile: Profile | null; onLogin: (profile: Profile) => void }) {
  const [status, setStatus] = useState('checking'), [existing, setExisting] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!linkToken) { setStatus('invalid'); return; }
    let alive = true;
    request<{ status: string }>(`/api/auth/invitations/validate?token=${encodeURIComponent(linkToken)}`).then(r => { if (alive) setStatus(r.status); }).catch(e => { if (alive) { setError(errorText(e)); setStatus('error'); } });
    return () => { alive = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    const data = values(event); setBusy(true); setError('');
    try {
      await request('/api/auth/invitations/accept', profile ? { token: linkToken } : { token: linkToken, fullName: data.get('fullName'), password: data.get('password') });
      linkToken = ''; setDone(true);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  if (done) return <><h1>Chào mừng bạn!</h1><Notice>Lời mời đã được chấp nhận. Đăng nhập để truy cập tổ chức của bạn.</Notice><a className="button primary" href="/login">Đăng nhập →</a></>;
  if (status === 'checking') return <p role="status">Đang kiểm tra lời mời…</p>;
  if (status !== 'valid') return <><h1>Lời mời không khả dụng</h1><Notice error>{error || 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng liên hệ HR để nhận lời mời mới.'}</Notice><a href="/login">Về trang đăng nhập</a></>;
  if (existing && !profile) return <><Login inline onLogin={onLogin} /><button className="text-button" onClick={() => setExisting(false)}>Tôi chưa có tài khoản</button></>;
  return <><div className="eyebrow">LỜI MỜI THAM GIA</div><h1>Sẵn sàng khởi đầu mới</h1><p className="muted">Lời mời xác định tổ chức và vai trò của bạn. Không thể tự thay đổi các thông tin này.</p>
    {error && <Notice error>{error}</Notice>}
    {profile && <Notice>Bạn đang xác nhận bằng tài khoản {profile.user.email}. Mật khẩu hiện tại sẽ được giữ nguyên.</Notice>}
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}>{!profile && <><Field label="Họ và tên" name="fullName" autoComplete="name" /><Field label="Tạo mật khẩu (12–128 ký tự)" name="password" type="password" autoComplete="new-password" minLength={12} /></>}<button className="primary">{busy ? 'Đang xác nhận…' : 'Chấp nhận lời mời →'}</button></fieldset></form>
    {!profile && <button className="text-button" onClick={() => setExisting(true)}>Tôi đã có tài khoản ManagerHR</button>}</>;
}

function Invitations({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<Invitation[]>([]), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const base = `/api/organizations/${profile.organization.id}/invitations`;
  async function load(p: number) {
    const data = await request<{ items: Invitation[] }>(`${base}?page=${p}&limit=10`); setItems(data.items);
  }
  useEffect(() => { if (!profile.permissions.invite) return; let alive = true; setBusy(true); request<{ items: Invitation[] }>(`${base}?page=${page}&limit=10`).then(r => { if (alive) setItems(r.items); }).catch(e => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, [base, page, profile.permissions.invite]);
  async function action(path: string, body: unknown, form?: HTMLFormElement) {
    setBusy(true); setError(''); setMessage('');
    try { await request(path, body); form?.reset(); setMessage('Yêu cầu đã được xử lý. Kiểm tra trạng thái lời mời bên dưới.'); await load(page); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function invite(event: FormEvent<HTMLFormElement>) { const form = event.currentTarget, data = values(event); void action(base, { email: data.get('email'), role: data.get('role') }, form); }
  if (!profile.permissions.invite) return <><h1>Không có quyền truy cập</h1><Notice error>Chỉ HR và quản trị viên được quản lý lời mời.</Notice><a href="/app">Về không gian làm việc</a></>;
  return <><div className="eyebrow">QUẢN LÝ THÀNH VIÊN</div><h1>Lời mời tham gia</h1><p className="muted">Mời đồng nghiệp vào {profile.organization.name}. Liên kết có hiệu lực trong 48 giờ.</p>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <form className="invite-form" onSubmit={invite} aria-busy={busy}><fieldset disabled={busy}><Field label="Email công việc" name="email" type="email" autoComplete="off" /><label className="field" htmlFor="role"><span>Vai trò</span><select id="role" name="role"><option value="EMPLOYEE">Nhân viên</option>{profile.permissions.grantHR && <option value="HR">Nhân sự</option>}</select></label><button className="primary">{busy ? 'Đang xử lý…' : 'Gửi lời mời'}</button></fieldset></form>
    <div className="table-wrap"><table><caption>Danh sách lời mời · Trang {page}</caption><thead><tr><th>Email / vai trò</th><th>Trạng thái</th><th>Gửi thư</th><th>Thao tác</th></tr></thead><tbody>{items.map(item => {
      const pending = !item.consumedAt && !item.revokedAt;
      const status = item.consumedAt ? 'Đã tham gia' : item.revokedAt ? 'Đã thu hồi' : new Date(item.expiresAt).getTime() <= Date.now() ? 'Hết hạn' : 'Đang chờ';
      return <tr key={item.id}><td><strong>{item.email}</strong><small>{roleName[item.role] || item.role}</small></td><td><span className="badge">{status}</span><small>Hạn: {new Date(item.expiresAt).toLocaleString('vi-VN')}</small></td><td>{item.deliveryStatus === 'SENT' ? 'Đã gửi' : item.deliveryStatus === 'FAILED' ? 'Gửi thất bại' : 'DEV_ONLY'}</td><td>{pending && <div className="row-actions"><button disabled={busy} onClick={() => void action(`${base}/${item.id}/resend`, {})}>Gửi lại</button><button disabled={busy} onClick={() => void action(`${base}/${item.id}/revoke`, {})}>Thu hồi</button></div>}</td></tr>;
    })}{items.length === 0 && <tr><td colSpan={4}>{busy ? 'Đang tải…' : 'Chưa có lời mời ở trang này.'}</td></tr>}</tbody></table></div>
    <nav className="pagination" aria-label="Phân trang lời mời"><button disabled={page === 1 || busy} onClick={() => setPage(p => p - 1)}>← Trước</button><span>Trang {page}</span><button disabled={items.length < 10 || busy} onClick={() => setPage(p => p + 1)}>Sau →</button></nav></>;
}

export default function App() {
  const [ready, setReady] = useState(false), [profile, setProfile] = useState<Profile | null>(null), [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('DEV_ONLY'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [route, setRoute] = useState(() => ({ pathname: window.location.pathname, search: window.location.search }));
  const path = route.pathname;
  useEffect(() => {
    let alive = true;
    const syncRoute = () => setRoute({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', syncRoute);
    initialize().then(async config => {
      if (!alive) return; setDeliveryMode(config.deliveryMode);
      try {
        const result = await request<Profile>('/api/auth/me');
        if (alive) {
          if (['/','/login'].includes(window.location.pathname)) {
            const destination=result.security?.mfaRequired&&!result.security?.mfaVerified?'/security':'/app';
            window.history.replaceState(null,'',destination);
            setRoute({ pathname: destination, search: '' });
          }
          setProfile(result);
        }
      }
      catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; }
      if (alive) setReady(true);
    }).catch(e => { if (alive) setError(errorText(e)); });
    return () => { alive = false; window.removeEventListener('popstate', syncRoute); };
  }, []);
  const navigate = (to: string) => {
    const destination = new URL(to, window.location.href);
    const relative = destination.pathname + destination.search + destination.hash;
    window.history.pushState(null, '', relative);
    setRoute({ pathname: destination.pathname, search: destination.search });
  };
  const onLogin = (result: Profile) => { setProfile(result); if (!['/invite/accept', '/register'].includes(path)) window.location.assign(result.security?.mfaRequired&&!result.security?.mfaVerified?'/security':'/app'); };
  async function logout() {
    setBusy(true); setError('');
    try { await request('/api/auth/logout', {}); window.location.assign('/login'); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  const limited=Boolean(profile?.security?.mfaRequired&&!profile?.security?.mfaVerified);
  const profileView=path==='/app'&&new URLSearchParams(route.search).get('view')==='profile';
  const personal=path==='/app'||path==='/security';
  const workspace=Boolean(ready&&profile&&!limited&&(personal||path.startsWith('/admin/')));
  const organizationHome=profile?.permissions.readUsers?'/admin/users':profile?.permissions.invite?'/admin/invitations':profile?.permissions.viewAudit?'/admin/audit':null;
  let content: ReactNode;
  if (!ready) { if (error) content = <><Notice error>{error}</Notice><button onClick={() => window.location.reload()}>Tải lại trang</button></>; else if (path.startsWith('/admin/') || path === '/app' || path === '/security') return <div className="workspace-loading-splash" role="status" aria-live="polite"><div className="workspace-loading-inner"><span className="dash-brand-mark" aria-hidden="true" /><div className="workspace-loading-text"><strong>ManagerHR</strong><span>Đang đồng bộ không gian làm việc…</span></div></div></div>; else content = <p role="status">Đang kết nối an toàn…</p>; }
  else if (profile && (path === '/security' || (profile.security?.mfaRequired && !profile.security?.mfaVerified && !['/forgot-password','/reset-password'].includes(path)))) content = <AccountSecurity profile={profile} />;
  else if (path === '/security') content = <Login onLogin={onLogin} />;
  else if (path === '/forgot-password') content = <Forgot />;
  else if (path === '/reset-password') content = <Reset />;
  else if (['/invite/accept', '/register'].includes(path)) content = <Accept profile={profile} onLogin={onLogin} />;
  else if (path === '/admin/invitations') content = profile ? <Invitations profile={profile} /> : <><Notice error>Vui lòng đăng nhập để quản lý lời mời.</Notice><Login onLogin={onLogin} /></>;
  else if (path === '/admin/users' || path === '/admin/audit') content = profile ? (path === '/admin/users' ? <UsersPanel profile={profile} /> : <AuditPanel profile={profile} />) : <Login onLogin={onLogin} />;
  else if (path === '/admin/org-chart') content = profile ? <OrganizationView profile={profile} activeTab="org-chart" onNavigate={navigate} /> : <Login onLogin={onLogin} />;
  else if (path === '/admin/departments') content = profile ? <OrganizationView profile={profile} activeTab="departments" onNavigate={navigate} /> : <Login onLogin={onLogin} />;
  else if (path === '/admin/positions') content = profile ? <OrganizationView profile={profile} activeTab="positions" onNavigate={navigate} /> : <Login onLogin={onLogin} />;
  else if (path === '/admin/organization') content = profile ? <OrganizationView profile={profile} activeTab="organization" onNavigate={navigate} /> : <Login onLogin={onLogin} />;
  else if (path === '/admin/employees') content = profile ? <Employees profile={profile} /> : <Login onLogin={onLogin} />;
  else if (path === '/app') content = profile ? (profileView?<AccountProfile profile={profile} />:<Dashboard profile={profile}/>) : <><Notice error>Phiên đăng nhập không còn hiệu lực.</Notice><Login onLogin={onLogin} /></>;
  else if (path === '/login' || path === '/') content = <Login onLogin={onLogin} />;
  else content = <><h1>Không tìm thấy trang</h1><a href="/login">Về trang đăng nhập</a></>;
  if(workspace&&profile)return <DashboardShell profile={profile} path={path} profileView={profileView} busy={busy} onLogout={()=>void logout()} onNavigate={navigate}>{deliveryMode==='DEV_ONLY'&&path==='/admin/invitations'&&<div className="dev-warning" role="status"><strong>DEV_ONLY · Chưa cấu hình gửi email</strong><span>Không có email thực tế được gửi trong chế độ này.</span></div>}{error&&<Notice error>{error}</Notice>}{content}</DashboardShell>;
  return <div className={`layout ${limited?'verification-layout':''}`}><a className="skip-link" href="#main-content">Đến nội dung chính</a><aside className="brand-panel"><a className="brand" href={profile ? '/app' : '/login'} aria-label="ManagerHR trang chủ"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 18V6l8 8 8-8v12" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Manager<span>HR</span></a>
      <div className="brand-story"><span className="hero-tag"><span aria-hidden="true">✦</span> NỀN TẢNG QUẢN TRỊ NHÂN SỰ</span><h2>Quản lý nhân sự.<br /><span>Kết nối đội ngũ.</span></h2><p>Mọi con người, một không gian chung.<br />Đơn giản hơn mỗi ngày cùng ManagerHR.</p>
        <div className="workspace-preview" aria-hidden="true"><div className="preview-top"><span className="preview-symbol">M</span><strong>Không gian đội ngũ</strong><span className="preview-dots">•••</span></div><div className="preview-body"><div className="preview-greeting"><span>CÙNG NHAU PHÁT TRIỂN</span><strong>Một đội ngũ. Nhiều khả năng.</strong></div><div className="preview-people"><span className="avatar avatar-blue">AN</span><span className="avatar avatar-purple">LH</span><span className="avatar avatar-teal">MT</span><span className="avatar avatar-peach">HK</span><span className="avatar avatar-more">+</span><span className="connection-line" /></div><div className="preview-flow"><span className="flow-check">✓</span><div><strong>Kết nối đúng người</strong><small>Lời mời riêng · Vai trò rõ ràng</small></div><span className="flow-arrow">↗</span></div><div className="preview-bottom"><span><i /> Không gian làm việc gắn kết</span><span>Minh họa giao diện</span></div></div></div>
        <div className="hero-benefits"><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m10 2 6 2v5c0 4-6 8-6 8s-6-4-6-8V4l6-2Z" stroke="currentColor" strokeWidth="1.5"/><path d="m7 9 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> Truy cập theo lời mời</span><span><span className="benefit-dot" /> Quản lý theo vai trò</span></div>
      </div><small className="brand-footer">Dành cho con người. Đồng hành cùng tổ chức.</small></aside>
    <main id="main-content" tabIndex={-1}><header className="topbar"><span className="security-label"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5" y="8" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="12" r="1" fill="currentColor"/></svg> Cổng thông tin nội bộ</span>{profile && <nav className="account-nav" aria-label="Tài khoản">{!limited&&<><a href="/app" aria-current={personal?'page':undefined}>Tài khoản</a>{organizationHome&&<a href={organizationHome} aria-current={path.startsWith('/admin/')?'page':undefined}>{profile.organization.role==='MANAGER'?'Nhóm của tôi':'Tổ chức'}</a>}</>}<button onClick={() => void logout()} disabled={busy}>Đăng xuất</button></nav>}</header><div className="content">
      {ready && deliveryMode === 'DEV_ONLY' && <div className="dev-warning" role="status"><strong>DEV_ONLY · Chưa cấu hình gửi email</strong><span>Không có email thực tế được gửi trong chế độ này.</span></div>}
      {ready && error && <Notice error>{error}</Notice>}{content}</div><footer className="main-footer"><span>Chỉ dành cho thành viên được tổ chức mời tham gia.</span><span>© {new Date().getFullYear()} ManagerHR</span></footer></main></div>;
}
