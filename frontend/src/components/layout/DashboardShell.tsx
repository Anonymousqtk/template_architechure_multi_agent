import { LanguageSelector } from '../../i18n/LanguageSelector';
import { useTranslation } from '../../i18n';
import { useSlideClose } from '../../hooks/useSlideClose';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { Profile } from '../../services/api';
import { roleLabel } from '../../features/users/account-types';
import '../../assets/styles/dashboard.css';
import '../../assets/styles/drawers.css';
export function DashIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: 'M3 10 12 3l9 7v10H3V10 M9 20v-7h6v7',
    users:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    mail: 'M3 5h18v14H3z M3 5l9 8 9-8',
    shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7L12 3 M8 12l3 3 5-5',
    list: 'M8 4h12v17H4V4h4 M8 2h8v4H8z M8 11h8 M8 15h6',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    menu: 'M3 6h18 M3 12h18 M3 18h18',
    logout: 'M9 3H3v18h6 M13 8l5 4-5 4 M8 12h13',
    user: 'M20 21v-2a7 7 0 0 0-14 0v2 M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    clock: 'M12 8v5l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  };
  const icons: Record<string, string> = {
    ...paths,
    money: 'M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    catalog: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    building: 'M4 21V3h12v18 M16 9h4v12 M2 21h20 M8 7h4 M8 11h4 M8 15h4 M8 21v-3h4v3',
    hierarchy: 'M9 3h6v5H9z M2 16h6v5H2z M16 16h6v5h-6z M12 8v4 M5 16v-4h14v4',
    briefcase: 'M3 7h18v13H3z M8 7V3h8v4 M3 12c6 4 12 4 18 0 M10 13h4',
    calendar: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h4 M7 17h2',
    leave: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15l2 2 4-4',
    settings:
      'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || paths.list} />
    </svg>
  );
}
type Props = {
  profile: Profile;
  path: string;
  profileView: boolean;
  busy: boolean;
  onLogout: () => void;
  onNavigate?: (to: string) => void;
  children: ReactNode;
};
export function DashboardShell({
  profile,
  path,
  profileView,
  busy,
  onLogout,
  onNavigate,
  children,
}: Props) {
  const { t, locale } = useTranslation();
  const [compact, setCompact] = useState(false),
    [preview, setPreview] = useState(false),
    [query, setQuery] = useState('');
  const employeeWorkspace = [
    '/admin/employees',
    '/admin/attendance',
    '/admin/payroll',
    '/admin/payroll-accounting',
    '/admin/my-payslips',
    '/admin/reports',
  ].includes(path);
  const catalogWorkspace = [
    '/admin/units',
    '/admin/departments',
    '/admin/positions',
    '/admin/work-shifts',
    '/admin/leave-types',
    '/admin/attendance-policy',
    '/admin/salary-components',
  ].includes(path);
  const activeGroup = catalogWorkspace
    ? 'catalog'
    : employeeWorkspace
      ? 'employees'
      : path.startsWith('/admin/')
        ? 'organization'
        : profileView || path === '/security'
          ? 'account'
          : null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);
  useEffect(() => {
    setOpenGroup(activeGroup);
  }, [activeGroup, path, profileView]);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia?.('(min-width: 1024px)').matches ?? true,
  );
  const sidebar = useRef<HTMLElement>(null),
    keyboard = useRef(false),
    pointerInside = useRef(false);
  const expanded = !compact || preview;
  const mobile = useRef<HTMLDialogElement>(null),
    openButton = useRef<HTMLButtonElement>(null),
    previousOverflow = useRef('');
  const {
    closing: mobileClosing,
    dismiss: closeMobile,
    cancel: cancelMobileClose,
  } = useSlideClose(() => {
    mobile.current?.close();
    document.body.style.overflow = previousOverflow.current;
    openButton.current?.focus();
  });
  useEffect(() => {
    const modal = mobile.current;
    const media = window.matchMedia?.('(min-width: 1024px)');
    const resize = () => {
      setDesktop(media?.matches ?? true);
      setPreview(false);
      if (media?.matches && modal?.open) {
        cancelMobileClose();
        modal.close();
        document.body.style.overflow = previousOverflow.current;
      }
    };
    media?.addEventListener('change', resize);
    return () => {
      media?.removeEventListener('change', resize);
      if (modal?.open) document.body.style.overflow = previousOverflow.current;
    };
  }, [cancelMobileClose]);
  useEffect(() => {
    const tab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keyboard.current = true;
    };
    const pointer = () => {
      keyboard.current = false;
    };
    window.addEventListener('keydown', tab, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', tab, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
  function navigation(prefix: string, visible: boolean) {
    const routeIcons: Record<string, string> = {
      '/admin/units': 'building',
      '/admin/departments': 'hierarchy',
      '/admin/positions': 'briefcase',
      '/admin/work-shifts': 'clock',
      '/admin/leave-types': 'leave',
      '/admin/attendance-policy': 'settings',
      '/admin/salary-components': 'settings',
      '/admin/org-chart': 'hierarchy',
      '/admin/users': 'users',
      '/admin/invitations': 'mail',
      '/admin/audit': 'list',
      '/admin/employees': 'user',
      '/admin/attendance': 'calendar',
      '/admin/payroll': 'money',
      '/admin/payroll-accounting': 'money',
      '/admin/my-payslips': 'list',
      '/admin/reports': 'list',
      '/app?view=profile': 'user',
      '/security': 'shield',
    };
    const link = (href: string, label: string, active: boolean) => (
      <a href={href} aria-label={label} aria-current={active ? 'page' : undefined}>
        <DashIcon name={routeIcons[href] ?? 'list'} />
        <span>{label}</span>
      </a>
    );
    function group(id: string, label: string, icon: string, children: ReactNode, section?: string) {
      const open = openGroup === id && visible;
      const active = id === activeGroup;
      const navLabel =
        id === 'catalog'
          ? t('catalog')
          : id === 'organization'
            ? t('organization')
            : id === 'employees'
              ? t('employees')
              : t('account');
      return (
        <nav aria-label={navLabel}>
          {section && (
            <p className="dash-nav-label">
              <span>{section}</span>
            </p>
          )}
          <button
            type="button"
            className="dash-nav-parent"
            aria-label={label}
            aria-expanded={open}
            aria-controls={prefix + '-' + id}
            data-active={active}
            onClick={() => {
              if (desktop && compact) setPreview(true);
              setOpenGroup((current) => (current === id ? null : id));
            }}
          >
            <DashIcon name={icon} />
            <span>{label}</span>
            <b className={open ? 'is-open' : ''} aria-hidden="true">
              ›
            </b>
          </button>
          <div
            className="dash-submenu"
            id={prefix + '-' + id}
            data-open={open}
            aria-hidden={!open}
            inert={!open}
          >
            <div>{children}</div>
          </div>
        </nav>
      );
    }
    const homeActive = path === '/app' && !profileView;
    return (
      <div className="dash-nav-inner">
        <nav aria-label={t('home')} lang={locale}>
          <a
            href="/app"
            className="dash-nav-parent"
            aria-label={t('home')}
            aria-current={homeActive ? 'page' : undefined}
            data-active={homeActive}
            onClick={() => {
              setOpenGroup(null);
            }}
          >
            <DashIcon name="home" />
            <span>{t('home')}</span>
          </a>
        </nav>
        {group(
          'catalog',
          t('catalog'),
          'catalog',
          <>
            {link('/admin/units', t('units'), path === '/admin/units')}
            {(profile.permissions.manageOrg ||
              ['ADMIN', 'HR', 'MANAGER'].includes(profile.organization.role)) && (
              <>
                {link('/admin/departments', t('departments'), path === '/admin/departments')}
                {link('/admin/positions', t('positions'), path === '/admin/positions')}
              </>
            )}
            {['ADMIN', 'HR'].includes(profile.organization.role) && (
              <>
                {link('/admin/work-shifts', t('shifts'), path === '/admin/work-shifts')}
                {link('/admin/leave-types', t('leaveTypes'), path === '/admin/leave-types')}
                {link(
                  '/admin/attendance-policy',
                  t('attendancePolicy'),
                  path === '/admin/attendance-policy',
                )}
                {link(
                  '/admin/salary-components',
                  t('salaryComponents'),
                  path === '/admin/salary-components',
                )}
              </>
            )}
          </>,
          t('sharedData'),
        )}
        {(profile.permissions.readUsers ||
          profile.permissions.invite ||
          profile.permissions.viewAudit ||
          profile.permissions.manageOrg) &&
          group(
            'organization',
            profile.organization.role === 'MANAGER' ? t('myTeam') : t('organization'),
            'hierarchy',
            <>
              {profile.permissions.readUsers &&
                link(
                  '/admin/users',
                  profile.organization.role === 'MANAGER' ? t('teamMembers') : t('members'),
                  path === '/admin/users',
                )}
              {profile.permissions.invite &&
                link('/admin/invitations', t('invitations'), path === '/admin/invitations')}
              {profile.permissions.viewAudit &&
                link('/admin/audit', t('audit'), path === '/admin/audit')}
              {(profile.permissions.manageOrg ||
                ['ADMIN', 'HR', 'MANAGER'].includes(profile.organization.role)) &&
                link('/admin/org-chart', t('orgChart'), path === '/admin/org-chart')}
            </>,
            t('hrApps'),
          )}
        {group(
          'employees',
          t('employees'),
          'users',
          <>
            {link(
              '/admin/employees',
              profile.organization.role === 'EMPLOYEE' ? t('myProfile') : t('employeeList'),
              path === '/admin/employees',
            )}
            {link('/admin/attendance', t('attendance'), path === '/admin/attendance')}
            {link('/admin/payroll', t('payroll'), path === '/admin/payroll')}
            {['ADMIN', 'HR'].includes(profile.organization.role) &&
              link(
                '/admin/payroll-accounting',
                t('accounting'),
                path === '/admin/payroll-accounting',
              )}
            {link('/admin/my-payslips', t('payslips'), path === '/admin/my-payslips')}
            {link('/admin/reports', t('reports'), path === '/admin/reports')}
          </>,
          t('hrManagement'),
        )}
        {group(
          'account',
          t('accountTitle'),
          'shield',
          <>
            {link('/app?view=profile', t('profile'), profileView)}
            {link('/security', t('security'), path === '/security')}
          </>,
          t('settings'),
        )}
      </div>
    );
  }
  function handleWorkspaceClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !onNavigate
    )
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search
    ) {
      if (destination.hash !== window.location.hash) return;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    onNavigate(destination.pathname + destination.search + destination.hash);
    if (mobile.current?.open) closeMobile();
  }
  const initials = profile.user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <div className={'hr-workspace' + (compact ? ' is-compact' : '')} onClick={handleWorkspaceClick}>
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <aside
        ref={sidebar}
        className="dash-sidebar"
        data-preview={compact && preview}
        data-expanded={expanded}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch' && desktop) {
            pointerInside.current = true;
            if (compact) setPreview(true);
          }
        }}
        onPointerLeave={() => {
          pointerInside.current = false;
          if (!keyboard.current || !sidebar.current?.contains(document.activeElement))
            setPreview(false);
        }}
        onFocusCapture={() => {
          if (keyboard.current && compact && desktop) setPreview(true);
        }}
        onBlurCapture={() => {
          queueMicrotask(() => {
            if (!sidebar.current?.contains(document.activeElement) && !pointerInside.current)
              setPreview(false);
          });
        }}
      >
        <div className="dash-brand-row">
          <a className="dash-brand" href="/app" aria-label="ManagerHR trang chủ">
            <span className="dash-brand-mark" aria-hidden="true">
              M
            </span>
            <strong>ManagerHR</strong>
          </a>
          <button
            className="dash-pin"
            aria-label={compact ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            aria-pressed={!compact}
            onClick={() => {
              setCompact(!compact);
              setPreview(false);
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
              {!compact && <circle cx="10" cy="10" r="2.5" fill="currentColor" />}
            </svg>
          </button>
        </div>
        <div className="dash-nav-scroll">{navigation('desktop-nav', expanded)}</div>
        <p className="dash-sidebar-note">
          <i />
          <span>{profile.organization.name}</span>
        </p>
      </aside>
      <dialog
        className={'dash-mobile-menu' + (mobileClosing ? ' is-closing' : '')}
        ref={mobile}
        aria-label="Điều hướng"
        onCancel={(event) => {
          event.preventDefault();
          closeMobile();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX > rect.right || event.clientX < rect.left) closeMobile();
        }}
      >
        <div className="dash-mobile-title">
          <a className="dash-brand" href="/app">
            <span className="dash-brand-mark" aria-hidden="true">
              M
            </span>
            <strong>ManagerHR</strong>
          </a>
          <button onClick={closeMobile} aria-label="Đóng menu" disabled={mobileClosing}>
            ×
          </button>
        </div>
        {navigation('mobile-nav', true)}
      </dialog>
      <main className="dash-main" id="main-content" tabIndex={-1}>
        <header className="dash-topbar">
          <button
            className="dash-mobile-toggle dash-icon-button"
            ref={openButton}
            aria-label="Mở điều hướng"
            onClick={() => {
              cancelMobileClose();
              previousOverflow.current = document.body.style.overflow;
              mobile.current?.showModal();
              document.body.style.overflow = 'hidden';
            }}
          >
            <DashIcon name="menu" />
          </button>
          {profile.permissions.readUsers ? (
            <form
              className="dash-search"
              onSubmit={(event) => {
                event.preventDefault();
                window.location.assign('/admin/users?q=' + encodeURIComponent(query.trim()));
              }}
            >
              <DashIcon name="search" />
              <input
                type="search"
                aria-label="Tìm thành viên từ dashboard"
                placeholder="Tìm thành viên"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
          ) : (
            <span className="dash-toolbar-org">{profile.organization.name}</span>
          )}
          <div className="dash-topbar-actions">
            <LanguageSelector />
            <a className="dash-icon-button" href="/security" aria-label={t('securitySettings')}>
              <DashIcon name="shield" />
            </a>
            <a className="dash-avatar" href="/app?view=profile" aria-label={t('personalAccount')}>
              {initials}
            </a>
            <button
              className="dash-icon-button"
              onClick={onLogout}
              disabled={busy}
              aria-label={t('signOut')}
            >
              <DashIcon name="logout" />
            </button>
          </div>
        </header>
        <div className="dash-content">{children}</div>
        <footer className="dash-footer">
          <span>© {new Date().getFullYear()} ManagerHR</span>
          <span>
            {profile.organization.name} · {roleLabel(profile.organization.role, locale)}
          </span>
        </footer>
      </main>
    </div>
  );
}
