import { useTranslation } from '../../../i18n';
import { accountDetailEnglish } from './accountDetailMessages';
import { useSlideClose } from '../../../hooks/useSlideClose';
import '../../../assets/styles/drawers.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  errorText,
  request,
  type Department,
  type Position,
  type Profile,
} from '../../../services/api';
import { roleLabel, roleLabels, statusLabel, type Account } from '../account-types';
import { Avatar } from '../../../components/common/Avatar';
import { SearchableSelect } from '../../../components/common/SearchableSelect';

type Props = { id: string; profile: Profile; onClose: () => void; onSaved: () => void };
export function AccountDetailDrawer({ id, profile, onClose, onSaved }: Props) {
  const { locale, t } = useTranslation();
  const tr = (text: string) => (locale === 'en' ? (accountDetailEnglish[text] ?? text) : text);
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    editor = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    saving = useRef(false);
  const [account, setAccount] = useState<Account | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [role, setRole] = useState(''),
    [managerId, setManagerId] = useState(''),
    [managerSearch, setManagerSearch] = useState(''),
    [managers, setManagers] = useState<Account[]>([]);
  const [deptId, setDeptId] = useState(''),
    [posId, setPosId] = useState(''),
    [departments, setDepartments] = useState<Department[]>([]),
    [positions, setPositions] = useState<Position[]>([]);
  const base = '/api/organizations/' + encodeURIComponent(profile.organization.id) + '/users';
  const orgBase = '/api/organizations/' + encodeURIComponent(profile.organization.id);
  const canChange = Boolean(account && account.id !== profile.user.id);
  const canAssign = canChange && Boolean(profile.permissions.assignRoles);
  const canAssignOrg =
    canChange &&
    Boolean(profile.permissions.manageOrg || profile.permissions.assignRoles) &&
    (profile.permissions.assignRoles || account?.role === 'EMPLOYEE');
  const canStatus =
    canChange &&
    Boolean(profile.permissions.manageUsers) &&
    (profile.permissions.assignRoles || account?.role === 'EMPLOYEE');
  const { closing, dismiss } = useSlideClose(onClose);
  const dirty = Boolean(
    editing &&
      account &&
      (role !== account.role ||
        (['EMPLOYEE', 'MANAGER'].includes(account.role) &&
          managerId !== (account.managerUserId || '')) ||
        deptId !== (account.departmentId || '') ||
        posId !== (account.positionId || '')),
  );
  useEffect(() => {
    const modal = dialog.current!,
      previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    modal.showModal();
    heading.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      else document.getElementById('users-heading')?.focus();
    };
  }, []);
  useEffect(() => {
    alive.current = true;
    let active = true;
    request<{ user: Account }>(base + '/' + encodeURIComponent(id))
      .then((r) => {
        if (active) {
          setAccount(r.user);
          setRole(r.user.role);
          setManagerId(r.user.managerUserId || '');
          setDeptId(r.user.departmentId || '');
          setPosId(r.user.positionId || '');
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [base, id]);
  useEffect(() => {
    if (!editing || !canAssign || !['EMPLOYEE', 'MANAGER'].includes(account?.role || '')) return;
    let active = true;
    const timer = window.setTimeout(() => {
      request<{ items: Account[] }>(
        base + '?role=MANAGER&status=active&limit=100&q=' + encodeURIComponent(managerSearch),
      )
        .then((r) => {
          if (active) setManagers(r.items);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [editing, canAssign, account?.role, base, managerSearch]);
  useEffect(() => {
    if (!editing || !canAssignOrg) return;
    let active = true;
    Promise.all([
      request<{ items: Department[] }>(orgBase + '/departments?limit=100'),
      request<{ items: Position[] }>(orgBase + '/positions?limit=100'),
    ])
      .then(([dRes, pRes]) => {
        if (active) {
          setDepartments(dRes.items);
          setPositions(pRes.items);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [editing, canAssignOrg, orgBase]);
  useEffect(() => {
    if (editing) editor.current?.querySelector<HTMLElement>('select,input')?.focus();
  }, [editing]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);
  function close() {
    if (saving.current || closing) return;
    if (dirty && !window.confirm(tr('Bỏ các thay đổi chưa lưu và đóng chi tiết?'))) return;
    dismiss();
  }
  function cancelEdit() {
    if (dirty && !window.confirm(tr('Bỏ các thay đổi chưa lưu?'))) return;
    if (account) {
      setRole(account.role);
      setManagerId(account.managerUserId || '');
      setDeptId(account.departmentId || '');
      setPosId(account.positionId || '');
    }
    setEditing(false);
    heading.current?.focus();
  }
  async function change(
    action: 'role' | 'manager' | 'status' | 'assignment',
    body: Record<string, unknown>,
  ) {
    if (!account || saving.current) return;
    if (
      action === 'role' &&
      managerId !== (account.managerUserId || '') &&
      !window.confirm(tr('Đổi vai trò sẽ bỏ phần phân công quản lý chưa lưu. Tiếp tục?'))
    )
      return;
    saving.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(base + '/' + encodeURIComponent(id) + '/' + action, body);
      if (!alive.current) return;
      const updated = {
        ...account,
        ...(action === 'role'
          ? { role: String(body.role), managerUserId: null }
          : action === 'manager'
            ? { managerUserId: body.managerUserId as string | null }
            : action === 'assignment'
              ? {
                  departmentId: body.departmentId as string | null,
                  positionId: body.positionId as string | null,
                }
              : { isActive: Boolean(body.isActive) }),
      };
      setAccount(updated);
      if (action === 'role') {
        setRole(updated.role);
        setManagerId('');
      }
      if (action === 'manager') setManagerId(updated.managerUserId || '');
      if (action === 'assignment') {
        setDeptId(updated.departmentId || '');
        setPosId(updated.positionId || '');
      }
      setMessage(tr('Đã cập nhật tài khoản.'));
      onSaved();
      try {
        const fresh = await request<{ user: Account }>(base + '/' + encodeURIComponent(id));
        if (alive.current) {
          setAccount(fresh.user);
          if (action === 'role') {
            setRole(fresh.user.role);
            setManagerId(fresh.user.managerUserId || '');
          }
          if (action === 'manager') setManagerId(fresh.user.managerUserId || '');
          if (action === 'assignment') {
            setDeptId(fresh.user.departmentId || '');
            setPosId(fresh.user.positionId || '');
          }
        }
      } catch {
        if (alive.current)
          setError(
            tr('Đã lưu thay đổi nhưng chưa tải lại được chi tiết. Đóng và mở lại để kiểm tra.'),
          );
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className={'account-drawer' + (closing ? ' is-closing' : '')}
      aria-labelledby="account-detail-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
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
          <span className="eyebrow">{editing ? tr('CHỈNH SỬA') : tr('THÔNG TIN TÀI KHOẢN')}</span>
          <h2 id="account-detail-title" ref={heading} tabIndex={-1}>
            {tr('Chi tiết tài khoản')}
          </h2>
        </div>
        <button
          className="secondary"
          onClick={close}
          disabled={busy || closing}
          aria-label={tr('Đóng chi tiết')}
        >
          ×
        </button>
      </header>
      <div className="drawer-body" inert={closing} aria-busy={loading || busy}>
        {error && (
          <p role="alert" className="notice error">
            {tr(error)}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {tr(message)}
          </p>
        )}
        {loading && <p role="status">{tr('Đang tải chi tiết…')}</p>}
        {account && (
          <>
            <div className={'drawer-profile-summary' + (editing ? ' is-editing' : '')}>
              <Avatar
                src={account.avatarUrl}
                name={account.fullName}
                className="drawer-profile-avatar"
              />
              <div>
                <h3>{account.fullName}</h3>
                <p>{editing ? account.email : roleLabel(account.role, locale)}</p>
                <span className={'drawer-account-badge' + (!account.isActive ? ' is-locked' : '')}>
                  {tr(statusLabel(account))}
                </span>
              </div>
            </div>
            {!editing && (
              <dl className="drawer-detail-list">
                <div>
                  <dt>Email</dt>
                  <dd>{account.email}</dd>
                </div>
                <div>
                  <dt>{tr('Vai trò')}</dt>
                  <dd>{roleLabel(account.role, locale)}</dd>
                </div>
                <div>
                  <dt>{tr('Phòng ban')}</dt>
                  <dd>{account.departmentName || tr('Chưa phân công')}</dd>
                </div>
                <div>
                  <dt>{tr('Chức danh')}</dt>
                  <dd>{account.positionTitle || tr('Chưa phân công')}</dd>
                </div>
                <div>
                  <dt>{tr('Trạng thái')}</dt>
                  <dd>{tr(statusLabel(account))}</dd>
                </div>
                <div>
                  <dt>{tr('Email xác minh')}</dt>
                  <dd>{account.emailVerified ? tr('Đã xác minh') : tr('Chưa xác minh')}</dd>
                </div>
                <div>
                  <dt>{tr('Tham gia')}</dt>
                  <dd>
                    {new Date(account.createdAt).toLocaleDateString(
                      locale === 'en' ? 'en-US' : 'vi-VN',
                    )}
                  </dd>
                </div>
              </dl>
            )}
            {!editing && (canAssign || canAssignOrg || canStatus) && (
              <button
                className="primary"
                onClick={() => {
                  setEditing(true);
                  setError('');
                  setMessage('');
                }}
              >
                {tr('Chỉnh sửa tài khoản')}
              </button>
            )}
            {!canAssign && !canAssignOrg && !canStatus && (
              <p className="muted">{tr('Bạn chỉ có quyền xem tài khoản này.')}</p>
            )}
            {editing && (
              <div ref={editor}>
                <p>
                  {tr(
                    'Lưu từng phần khi cần. Đổi vai trò hoặc khóa tài khoản sẽ thu hồi các phiên liên quan.',
                  )}
                </p>
                {canAssign && (
                  <form
                    className="role-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (window.confirm(tr('Đổi vai trò của ') + account.email + '?'))
                        void change('role', { role });
                    }}
                  >
                    <label className="field">
                      {tr('Vai trò mới')}
                      <select
                        value={role}
                        onChange={(event) => setRole(event.target.value)}
                        disabled={busy}
                      >
                        {Object.entries(roleLabels).map(([value]) => (
                          <option key={value} value={value}>
                            {roleLabel(value, locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary" disabled={busy || role === account.role}>
                      {tr('Lưu vai trò')}
                    </button>
                  </form>
                )}
                {canAssignOrg && (
                  <form
                    className="role-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void change('assignment', {
                        departmentId: deptId || null,
                        positionId: posId || null,
                      });
                    }}
                  >
                    <label className="field">
                      {tr('Phòng ban')}
                      <SearchableSelect
                        value={deptId}
                        disabled={busy}
                        onChange={(val) => {
                          setDeptId(val);
                          setPosId('');
                        }}
                        options={[
                          { value: '', label: tr('Chưa phân công phòng ban') },
                          ...departments.map((d) => ({
                            value: d.id,
                            label: `${d.name} (${d.code})`,
                            keywords: `${d.name} ${d.code}`,
                          })),
                        ]}
                      />
                    </label>
                    <label className="field">
                      {tr('Chức danh')}
                      <SearchableSelect
                        value={posId}
                        disabled={busy}
                        onChange={setPosId}
                        options={[
                          { value: '', label: tr('Chưa phân công chức danh') },
                          ...positions
                            .filter((p) => !p.departmentId || !deptId || p.departmentId === deptId)
                            .map((p) => ({
                              value: p.id,
                              label: `${p.title} (${p.code})`,
                              keywords: `${p.title} ${p.code}`,
                            })),
                        ]}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        (deptId === (account.departmentId || '') &&
                          posId === (account.positionId || ''))
                      }
                    >
                      {tr('Lưu phòng ban & chức danh')}
                    </button>
                  </form>
                )}
                {canAssign && ['EMPLOYEE', 'MANAGER'].includes(account.role) && (
                  <form
                    className="role-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void change('manager', { managerUserId: managerId || null });
                    }}
                  >
                    <label className="field">
                      {tr('Tìm người quản lý')}
                      <input
                        type="search"
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label className="field">
                      {tr('Người quản lý')}
                      <SearchableSelect
                        value={managerId}
                        disabled={busy}
                        onChange={setManagerId}
                        options={[
                          { value: '', label: tr('Chưa phân công') },
                          ...(managerId && !managers.some((manager) => manager.id === managerId)
                            ? [{ value: managerId, label: tr('Người quản lý hiện tại') }]
                            : []),
                          ...managers.map((manager) => ({
                            value: manager.id,
                            label: `${manager.fullName} · ${manager.email}`,
                            keywords: `${manager.fullName} ${manager.email}`,
                          })),
                        ]}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || managerId === (account.managerUserId || '')}
                    >
                      {tr('Lưu phân công')}
                    </button>
                  </form>
                )}
                {canStatus && (
                  <section className="drawer-danger">
                    <h3>{tr('Trạng thái truy cập')}</h3>
                    <p>{tr('Khóa tài khoản sẽ chặn đăng nhập và thu hồi các phiên liên quan.')}</p>
                    <button
                      className="secondary"
                      disabled={busy || !account.userIsActive}
                      onClick={() => {
                        if (
                          window.confirm(
                            (account.isActive ? tr('Khóa') : tr('Mở khóa')) +
                              tr(' tài khoản ') +
                              account.email +
                              '?',
                          )
                        )
                          void change('status', { isActive: !account.isActive });
                      }}
                    >
                      {account.isActive ? tr('Khóa tài khoản') : tr('Mở khóa tài khoản')}
                    </button>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <footer className="drawer-footer">
        <button type="button" className="secondary" disabled={busy || closing} onClick={close}>
          {t('cancel')}
        </button>
        {editing ? (
          <button className="secondary" disabled={busy || closing} onClick={cancelEdit}>
            {tr('Quay lại thông tin')}
          </button>
        ) : (
          <span>{tr('Chỉ hiển thị thông tin trong phạm vi quyền của bạn.')}</span>
        )}
        {busy && <span role="status">{tr('Đang lưu, vui lòng đợi…')}</span>}
      </footer>
    </dialog>,
    document.body,
  );
}
