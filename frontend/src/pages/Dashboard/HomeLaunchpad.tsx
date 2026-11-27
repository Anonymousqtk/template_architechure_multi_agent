import { useTranslation } from '../../i18n';
import type { Profile } from '../../services/api';
import { DashIcon } from '../../components/layout/DashboardShell';
import { homeMessages } from './homeMessages';

type Tile = { href: string; icon: string; title: string; description: string };

/** Three frequent tasks per role; the sidebar contains the full application menu. */
export function HomeLaunchpad({ profile }: { profile: Profile }) {
  const { t, locale } = useTranslation();
  const msg = homeMessages[locale];
  const role = profile.organization.role;
  const staff = ['ADMIN', 'HR'].includes(role);
  const employee = role === 'EMPLOYEE';
  const tiles: Tile[] = [
    {
      href: '/admin/attendance',
      icon: 'calendar',
      title: t('attendance'),
      description: msg.attendanceDesc,
    },
    {
      href: '/admin/employees',
      icon: 'user',
      title: employee ? t('myProfile') : t('employeeList'),
      description: employee ? msg.myProfileDesc : msg.employeesDesc,
    },
    staff
      ? { href: '/admin/payroll', icon: 'money', title: t('payroll'), description: msg.payrollDesc }
      : employee
        ? {
            href: '/admin/my-payslips',
            icon: 'list',
            title: t('payslips'),
            description: msg.payslipsDesc,
          }
        : {
            href: '/admin/reports',
            icon: 'catalog',
            title: t('reports'),
            description: msg.reportsDesc,
          },
  ];

  return (
    <section className="home-launchpad home-quick-actions" aria-labelledby="home-launchpad-title">
      <header className="home-section-heading">
        <div>
          <h2 id="home-launchpad-title">{msg.launchpadTitle}</h2>
          <p>{msg.launchpadSubtitle}</p>
        </div>
      </header>
      <nav aria-label={msg.launchpadNav}>
        <ul className="home-priority-tiles">
          {tiles.map((tile) => (
            <li key={tile.href}>
              <a className="home-tile" href={tile.href}>
                <span className="home-tile-icon" aria-hidden="true">
                  <DashIcon name={tile.icon} />
                </span>
                <span className="home-tile-copy">
                  <strong>{tile.title}</strong>
                  <small>{tile.description}</small>
                </span>
                <span className="home-tile-arrow" aria-hidden="true">
                  ?
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
