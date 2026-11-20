import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Profile } from './api';

const profile: Profile = { user: { id: 'user-1', email: 'member@example.test', fullName: 'Test Member' }, organization: { id: 'org-1', name: 'Test Company', role: 'ADMIN' }, permissions: { invite: true, grantHR: true }, deliveryMode: 'DEV_ONLY' };
const calls: { path: string; init?: RequestInit }[] = [];
let signedIn: Profile | null = null;
let handle: (path: string, init?: RequestInit) => Response | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mount(path: string) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  // Preserve React's renderer identity while reloading the module-level link token.
  vi.doMock('react', () => React);
  const { default: App } = await import('./App');
  const view = render(<App />);
  await waitFor(() => expect(calls.some(call => call.path === '/api/auth/me')).toBe(true));
  return view;
}
beforeEach(() => {
  signedIn = null; calls.length = 0; handle = () => undefined;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const custom = handle(path, init); if (custom) return custom;
    if (path === '/api/auth/csrf') return json({ csrfToken: 'test-csrf-value', deliveryMode: 'DEV_ONLY' });
    if (path === '/api/auth/me') return signedIn ? json(signedIn) : json({ code: 'AUTHENTICATION_REQUIRED' }, 401);
    if (path.startsWith('/api/auth/invitations/validate')) return json({ status: 'valid' });
    if (path.includes('/invitations?page=')) return json({ items: [], page: 1, limit: 10 });
    if (path === '/api/auth/login') return json({ code: 'INVALID_CREDENTIALS' }, 401);
    return new Response(null, { status: 204 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authentication screens', () => {
  it('login has labeled controls, generic focused errors, CSRF header and no public registration', async () => {
    const { container } = await mount('/login');
    const email = await screen.findByLabelText(/Email/);
    fireEvent.change(email, { target: { value: 'member@example.test' } });
    const password = container.querySelector<HTMLInputElement>('input[name="password"]')!;
    expect(password.labels).toHaveLength(1); expect(password).toHaveAttribute('autocomplete', 'current-password');
    fireEvent.change(password, { target: { value: 'incorrect password' } });
    fireEvent.submit(container.querySelector('form')!);
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Email'); expect(alert).toHaveFocus();
    const login = calls.find(call => call.path === '/api/auth/login')!;
    expect(login.init?.credentials).toBe('same-origin'); expect(login.init?.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf-value' });
    expect(container.querySelector('a[href="/register"]')).toBeNull();
  });
  it('forgot password shows generic response and explicit DEV_ONLY delivery limitation', async () => {
    const { container } = await mount('/forgot-password');
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'unknown@example.test' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(calls.some(call => call.path === '/api/auth/forgot-password')).toBe(true));
    expect(await screen.findByText(/Nếu tài khoản tồn tại/)).toBeInTheDocument();
    expect(screen.getByText(/DEV_ONLY/)).toBeInTheDocument();
    expect(screen.getByText(/Không có email thực tế/)).toBeInTheDocument();
  });
  it('AUTH-22 removes reset token from history, keeps it only in memory and resets without automatic login', async () => {
    const secret = 'A'.repeat(43); const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = await mount(`/reset-password?token=${secret}`);
    expect(window.location.search).toBe('');
    await screen.findByRole('heading', { level: 1, name: /Đặt lại mật khẩu/ });
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="password"]')) fireEvent.change(input, { target: { value: 'new sufficiently long password' } });
    fireEvent.submit(container.querySelector('form')!);
    await screen.findByRole('heading', { level: 1, name: /Mật khẩu đã được cập nhật/ });
    const reset = calls.find(call => call.path === '/api/auth/reset-password')!;
    expect(JSON.parse(String(reset.init?.body))).toEqual({ token: secret, newPassword: 'new sufficiently long password' });
    expect(calls.some(call => call.path === '/api/auth/login')).toBe(false); expect(storage).not.toHaveBeenCalled();
  });
  it('rejects mismatched reset confirmation before sending a mutation', async () => {
    const { container } = await mount(`/reset-password?token=${'B'.repeat(43)}`);
    await screen.findByRole('heading', { level: 1, name: /Đặt lại mật khẩu/ });
    fireEvent.change(container.querySelector('input[name="password"]')!, { target: { value: 'new sufficiently long password' } });
    fireEvent.change(container.querySelector('input[name="confirmation"]')!, { target: { value: 'a different long password' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/chưa trùng khớp/);
    expect(calls.some(call => call.path === '/api/auth/reset-password')).toBe(false);
  });
  it('register is invitation-only and rejects missing token', async () => {
    const { container } = await mount('/register');
    await screen.findByRole('heading', { level: 1, name: /Lời mời không khả dụng/ });
    expect(container.querySelector('form')).toBeNull();
    expect(calls.some(call => call.path === '/api/auth/register')).toBe(false);
  });
  it('new invite accepts with name/password and cannot self-select role or organization', async () => {
    const secret = 'C'.repeat(43); const { container } = await mount(`/invite/accept?token=${secret}`);
    fireEvent.change(await screen.findByLabelText(/Họ và tên/), { target: { value: 'Invited Member' } });
    fireEvent.change(container.querySelector('input[name="password"]')!, { target: { value: 'new sufficiently long password' } });
    expect(container.querySelector('select')).toBeNull(); fireEvent.submit(container.querySelector('form')!);
    await screen.findByRole('heading', { level: 1, name: /Chào mừng bạn/ });
    expect(JSON.parse(String(calls.find(call => call.path === '/api/auth/invitations/accept')!.init?.body))).toEqual({ token: secret, fullName: 'Invited Member', password: 'new sufficiently long password' });
    expect(window.location.search).toBe('');
  });
  it('existing authenticated user accepts without sending or overwriting a password', async () => {
    signedIn = profile; const secret = 'D'.repeat(43); const { container } = await mount(`/invite/accept?token=${secret}`);
    await screen.findByText(/member@example.test/);
    expect(container.querySelector('input[type="password"]')).toBeNull(); fireEvent.submit(container.querySelector('form')!);
    await screen.findByRole('heading', { level: 1, name: /Chào mừng bạn/ });
    expect(JSON.parse(String(calls.find(call => call.path === '/api/auth/invitations/accept')!.init?.body))).toEqual({ token: secret });
  });
  it('employee cannot see invitation administration controls', async () => {
    signedIn = { ...profile, organization: { ...profile.organization, role: 'EMPLOYEE' }, permissions: { invite: false, grantHR: false } };
    const { container } = await mount('/admin/invitations');
    await screen.findByRole('heading', { level: 1, name: /Không có quyền truy cập/ });
    expect(container.querySelector('form')).toBeNull(); expect(container.querySelector('select')).toBeNull();
  });
  it('HR invitation form offers employee only and submits own organization', async () => {
    signedIn = { ...profile, organization: { ...profile.organization, role: 'HR' }, permissions: { invite: true, grantHR: false } };
    const { container } = await mount('/admin/invitations');
    const email = await screen.findByLabelText(/Email/);
    await waitFor(() => expect(email).not.toBeDisabled());
    expect(container.querySelectorAll('select option')).toHaveLength(1);
    fireEvent.change(email, { target: { value: 'new@example.test' } }); fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(calls.some(call => call.path === '/api/organizations/org-1/invitations' && call.init?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(calls.find(call => call.path === '/api/organizations/org-1/invitations' && call.init?.method === 'POST')!.init?.body))).toEqual({ email: 'new@example.test', role: 'EMPLOYEE' });
  });
  it('shows a matching invitation avatar and opens the zoom viewer', async () => {
    signedIn = profile;
    const avatarUrl = '/api/organizations/org-1/users/joined/avatar?v=version';
    handle = path => path.includes('/invitations?page=') ? json({
      items: [{
        id: 'invite-1', email: 'joined@example.test', role: 'EMPLOYEE',
        expiresAt: '2026-12-01T00:00:00.000Z', consumedAt: '2026-11-19T00:00:00.000Z',
        revokedAt: null, deliveryStatus: 'SENT', avatarUrl,
      }],
      page: 1, limit: 10,
    }) : undefined;
    await mount('/admin/invitations');
    const avatar = await screen.findByRole('button', { name: 'Xem ảnh đại diện của joined@example.test' });
    expect(avatar.querySelector('img')).toHaveAttribute('src', avatarUrl);
    fireEvent.click(avatar);
    const viewer = await screen.findByRole('dialog', { name: 'Ảnh đại diện của joined@example.test' });
    expect(viewer.tagName).toBe('DIALOG');
    expect(viewer).toBeVisible();
    fireEvent(viewer, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(viewer).not.toBeInTheDocument());
  });
  it('signed-in user can discover security/session management from account navigation',async()=>{
    signedIn=profile;
    await mount('/app');
    fireEvent.click(await screen.findByRole('button',{name:'Tài khoản'}));
    expect(await screen.findByRole('link',{name:'Bảo mật & thiết bị'})).toHaveAttribute('href','/security');
  });
  it('password reset page remains accessible during a pending MFA challenge',async()=>{
    signedIn={...profile,security:{mfaRequired:true,mfaEnabled:true,mfaVerified:false}};
    await mount('/reset-password?token=reset-token');
    await waitFor(()=>expect(document.querySelector('input[autocomplete="new-password"]')).toBeInTheDocument());
    expect(calls.some(call=>call.path==='/api/auth/mfa/status')).toBe(false);
  });

it('employee sees only personal navigation and direct invitations do not fetch data',async()=>{signedIn={...profile,organization:{...profile.organization,role:'EMPLOYEE'},permissions:{invite:false,grantHR:false}};await mount('/admin/invitations');expect(await screen.findByRole('heading',{name:'Không có quyền truy cập'})).toBeVisible();expect(calls.some(c=>c.path.includes('/invitations?page='))).toBe(false);expect(screen.queryByRole('link',{name:'Tài khoản tổ chức'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Nhật ký'})).not.toBeInTheDocument();fireEvent.click(screen.getAllByText('Tài khoản')[0]);expect(screen.getByRole('link',{name:'Thông tin cá nhân'})).toBeVisible();});
it('account home has a single navigation entry for organization accounts and invitations',async()=>{signedIn={...profile,permissions:{...profile.permissions,readUsers:true}};await mount('/app');await screen.findByRole('heading',{name:/Xin chào/});const orgNav=screen.getByRole('navigation',{name:'Quản lý tổ chức'});expect(orgNav.querySelectorAll('a[href="/admin/users"]')).toHaveLength(1);expect(orgNav.querySelectorAll('a[href="/admin/invitations"]')).toHaveLength(1);expect(screen.getByRole('navigation',{name:'Cài đặt tài khoản'})).toBeVisible();});
it.each(['/','/login'])('restores a verified server session from %s without another login',async path=>{signedIn={...profile,security:{mfaRequired:true,mfaEnabled:true,mfaVerified:true}};await mount(path);expect(await screen.findByRole('heading',{name:/Xin chào/})).toBeInTheDocument();expect(window.location.pathname).toBe('/app');expect(screen.queryByLabelText('Mật khẩu')).not.toBeInTheDocument();expect(calls.some(c=>c.path==='/api/auth/login')).toBe(false);});
it('keeps anonymous root visitors on login',async()=>{await mount('/');expect(await screen.findByRole('heading',{name:'Đăng nhập'})).toBeVisible();expect(window.location.pathname).toBe('/');expect(screen.queryByRole('heading',{name:/Xin chào/})).not.toBeInTheDocument();});
it('keeps an incomplete MFA session in the sign-in flow',async()=>{signedIn={...profile,permissions:{invite:false,grantHR:false},security:{mfaRequired:true,mfaEnabled:true,mfaVerified:false}};handle=path=>path==='/api/auth/mfa/status'?json({enabled:true,required:true,verified:false,recoveryCodesRemaining:4}):undefined;await mount('/');expect(await screen.findByRole('heading',{name:'Xác minh đăng nhập'})).toBeVisible();expect(window.location.pathname).toBe('/');expect(screen.getByLabelText('Mã 6 số từ Authenticator')).toHaveFocus();expect(calls.some(c=>c.path==='/api/auth/sessions')).toBe(false);expect(screen.queryByRole('heading',{name:/Xin chào/})).not.toBeInTheDocument();});
it('groups organization screens and marks the current section without mounting other panels',async()=>{signedIn={...profile,permissions:{invite:true,grantHR:true,readUsers:true,viewAudit:true}};await mount('/admin/invitations');expect(await screen.findByRole('heading',{name:'Lời mời tham gia'})).toBeVisible();const nav=screen.getByRole('navigation',{name:'Quản lý tổ chức'});expect(nav.querySelector('a[aria-current="page"]')).toHaveAttribute('href','/admin/invitations');expect(screen.getByRole('link',{name:'Thành viên'})).toBeVisible();expect(screen.getByRole('link',{name:'Nhật ký hoạt động'})).toBeVisible();expect(calls.some(c=>c.path.includes('/users?')||c.path.includes('/audit-events'))).toBe(false);});
it('MFA challenge has focused navigation without account or organization links',async()=>{signedIn={...profile,security:{mfaRequired:true,mfaEnabled:true,mfaVerified:false}};handle=path=>path==='/api/auth/mfa/status'?json({enabled:true,required:true,verified:false,recoveryCodesRemaining:4}):undefined;await mount('/security');expect(await screen.findByRole('heading',{name:'Xác minh đăng nhập'})).toBeVisible();expect(screen.queryByRole('navigation',{name:'Cài đặt tài khoản'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Tổ chức'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Quay lại đăng nhập'})).toBeVisible();});
it('verified security shares account navigation and has one page heading',async()=>{signedIn={...profile,security:{mfaRequired:true,mfaEnabled:true,mfaVerified:true}};handle=path=>path==='/api/auth/mfa/status'?json({enabled:true,required:true,verified:true,recoveryCodesRemaining:4}):path==='/api/auth/sessions'?json({items:[]}):undefined;await mount('/security');expect(await screen.findByRole('heading',{level:1,name:'Bảo mật & thiết bị'})).toBeVisible();expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.getByRole('link',{name:'Bảo mật & thiết bị'})).toHaveAttribute('aria-current','page');expect(screen.getByRole('link',{name:'Thông tin cá nhân'})).toBeVisible();});

it('uses a backup code and resumes the original protected page', async () => {
  signedIn = { ...profile, security: { mfaRequired: true, mfaEnabled: true, mfaVerified: false } };
  handle = path => {
    if (path !== '/api/auth/mfa/verify') return undefined;
    signedIn = { ...profile, security: { mfaRequired: true, mfaEnabled: true, mfaVerified: true } };
    return new Response(null, { status: 204 });
  };
  await mount('/admin/invitations');
  fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã dự phòng' }));
  const code = screen.getByLabelText('Mã dự phòng');
  expect(code).toHaveFocus();
  fireEvent.change(code, { target: { value: 'a'.repeat(32) } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh và tiếp tục' }));
  await waitFor(() => expect(calls.some(call => call.path.includes('/invitations?page='))).toBe(true));
  expect(window.location.pathname).toBe('/admin/invitations');
  expect(calls.find(call => call.path === '/api/auth/mfa/verify')?.init?.body).toBe(JSON.stringify({ code: 'a'.repeat(32) }));
});
it('keeps personal profile separate from the overview dashboard',async()=>{signedIn=profile;await mount('/app?view=profile');expect(await screen.findByLabelText('Tên hiển thị')).toBeVisible();expect(screen.queryByRole('heading',{name:'Tổng quan đội ngũ'})).not.toBeInTheDocument();expect(calls.some(call=>call.path==='/api/auth/sessions')).toBe(false);expect(screen.getByRole('link',{name:'Thông tin cá nhân'})).toHaveAttribute('aria-current','page');});
it('navigates between workspace menu pages without rechecking the session or flashing login',async()=>{signedIn=profile;await mount('/app');expect(await screen.findByRole('heading',{name:/Xin chào/})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Tài khoản'}));fireEvent.click(screen.getByRole('link',{name:'Thông tin cá nhân'}));expect(await screen.findByLabelText('Tên hiển thị')).toBeVisible();expect(window.location.pathname).toBe('/app');expect(window.location.search).toBe('?view=profile');expect(calls.filter(call=>call.path==='/api/auth/me')).toHaveLength(1);expect(screen.queryByRole('heading',{name:'Đăng nhập'})).not.toBeInTheDocument();window.history.pushState(null,'','/app');fireEvent.popState(window);expect(await screen.findByRole('heading',{name:/Xin chào/})).toBeVisible();});
});
