import { useEffect, useRef, useState, type FormEvent } from 'react';
import { request, errorText, type Profile } from './api';
import { type Employee, type EmployeePage, employmentLabels } from './employee-types';
import { EmployeeDetailDrawer } from './EmployeeDetailDrawer';
import './employees.css';

type Choice = {
  id: string;
  fullName?: string;
  email?: string;
  name?: string;
  title?: string;
  role?: string;
  departmentId?: string | null;
};

export function SearchChoice({
  base,
  resource,
  label,
  value,
  onChange,
  initialLabel,
  role,
  departmentId,
}: {
  base: string;
  resource: 'users' | 'departments' | 'positions';
  label: string;
  value: string;
  onChange: (id: string) => void;
  initialLabel?: string | null;
  role?: string;
  departmentId?: string;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: '20', q });
      if (role) params.set('role', role);
      if (resource === 'users') params.set('status', 'active');
      if (resource !== 'users') params.set('isActive', 'true');
      request<EmployeePage<Choice>>(`${base}/${resource}?${params}`)
        .then(r => {
          if (alive) {
            setItems(r.items);
            setError('');
          }
        })
        .catch(e => {
          if (alive) setError(errorText(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base, resource, q, role, retry]);

  const choices = items.filter(
    item => resource !== 'positions' || !item.departmentId || item.departmentId === departmentId
  );

  return (
    <div className="emp-choice">
      <label className="field">
        <span>Tìm {label.toLowerCase()}</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nhập tên hoặc mã để tìm" />
      </label>
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={e => onChange(e.target.value)} aria-busy={loading}>
          <option value="">Chưa chọn</option>
          {value && !choices.some(c => c.id === value) && (
            <option value={value}>{initialLabel || 'Đã chọn'}</option>
          )}
          {choices.map(c => (
            <option key={c.id} value={c.id}>
              {c.name || c.title || c.fullName}
              {c.email ? ' · ' + c.email : ''}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert">
          {error}
          <button type="button" className="secondary" onClick={() => setRetry(n => n + 1)}>
            Thử tải lại
          </button>
        </p>
      )}
    </div>
  );
}

const nullable = (f: FormData, name: string) => String(f.get(name) || '').trim() || null;
const dateLabel = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : '—';

export function Employees({ profile }: { profile: Profile }) {
  const base = '/api/organizations/' + encodeURIComponent(profile.organization.id);
  const url = base + '/employees';
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);

  const [list, setList] = useState<EmployeePage<Employee> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  const [creating, setCreating] = useState(false);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  const notice = useRef<HTMLDivElement>(null);
  const canCreate = ['ADMIN', 'HR'].includes(profile.organization.role);

  useEffect(() => {
    setSelected('');
    setCreating(false);
    setList(null);
    setPage(1);
  }, [profile.organization.id, profile.user.id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: '20', q: search });
    if (status) params.set('status', status);
    request<EmployeePage<Employee>>(url + '?' + params)
      .then(r => {
        if (alive) setList(r);
      })
      .catch(e => {
        if (alive) setError(errorText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, page, search, status, revision]);

  useEffect(() => {
    if (error) notice.current?.focus();
  }, [error]);

  function profileFields(f: FormData) {
    return {
      employeeCode: String(f.get('employeeCode')),
      fullName: String(f.get('fullName')),
      birthDate: nullable(f, 'birthDate'),
      phone: nullable(f, 'phone'),
      personalEmail: nullable(f, 'personalEmail'),
      address: nullable(f, 'address'),
    };
  }

  function submitCreateProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setSuccess('');
    request<{ id: string }>(url, {
      ...profileFields(f),
      hireDate: String(f.get('hireDate')),
      userId: account || null,
    })
      .then(result => {
        setSuccess('Đã tạo hồ sơ nhân viên thành công.');
        setCreating(false);
        setRevision(n => n + 1);
        setSelected(result.id);
      })
      .catch(err => {
        setError(errorText(err));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function pagination(current: number, total: number, set: (page: number) => void) {
    return (
      <div className="emp-pagination">
        <button className="secondary" disabled={current === 1 || loading} onClick={() => set(current - 1)}>
          Trước
        </button>
        <span>
          Trang {current} · {total} kết quả
        </span>
        <button
          className="secondary"
          disabled={current * 20 >= total || loading}
          onClick={() => set(current + 1)}
        >
          Sau
        </button>
      </div>
    );
  }

  return (
    <div className="emp-page">
      <header className="emp-heading">
        <div>
          <div className="eyebrow">QUẢN LÝ NHÂN SỰ</div>
          <h1>{profile.organization.role === 'EMPLOYEE' ? 'Hồ sơ của tôi' : 'Hồ sơ nhân viên'}</h1>
          <p>Danh sách hồ sơ nhân sự, hợp đồng lao động và lịch sử công tác.</p>
        </div>
        {canCreate && (
          <button
            className="primary"
            onClick={() => {
              setCreating(true);
              setAccount('');
              setSuccess('');
            }}
          >
            Thêm nhân viên
          </button>
        )}
      </header>

      {error && (
        <div ref={notice} tabIndex={-1} role="alert" className="notice error">
          {error}
          <button className="secondary" onClick={() => setRevision(n => n + 1)} disabled={busy || loading}>
            Thử tải lại
          </button>
        </div>
      )}
      {success && <p role="status" className="notice success">{success}</p>}

      {creating && (
        <section className="dash-card emp-editor">
          <h2>Tạo hồ sơ nhân viên mới</h2>
          <form onSubmit={submitCreateProfile}>
            <fieldset disabled={busy}>
              <div className="emp-form-grid">
                <label className="field">
                  <span>Mã nhân viên</span>
                  <input name="employeeCode" required maxLength={30} placeholder="VD: EMP-001" />
                </label>
                <label className="field">
                  <span>Họ và tên hồ sơ</span>
                  <input name="fullName" required maxLength={150} placeholder="Họ và tên đầy đủ" />
                </label>
                <label className="field">
                  <span>Ngày vào làm</span>
                  <input name="hireDate" type="date" required />
                </label>
                <label className="field">
                  <span>Ngày sinh</span>
                  <input name="birthDate" type="date" />
                </label>
                <label className="field">
                  <span>Số điện thoại cá nhân</span>
                  <input name="phone" type="tel" maxLength={32} placeholder="Số điện thoại di động" />
                </label>
                <label className="field">
                  <span>Email cá nhân</span>
                  <input name="personalEmail" type="email" maxLength={254} placeholder="email@example.com" />
                </label>
                <label className="field emp-span">
                  <span>Địa chỉ liên hệ</span>
                  <input name="address" maxLength={500} placeholder="Địa chỉ thường trú hoặc tạm trú" />
                </label>
                <div className="emp-span">
                  <SearchChoice
                    base={base}
                    resource="users"
                    label="Tài khoản liên kết (tùy chọn)"
                    role={profile.organization.role === 'HR' ? 'EMPLOYEE' : undefined}
                    value={account}
                    onChange={setAccount}
                  />
                </div>
              </div>
              <div className="emp-actions">
                <button className="primary" type="submit">
                  {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
                </button>
                <button type="button" className="secondary" onClick={() => setCreating(false)}>
                  Hủy
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      <section className="dash-card">
        <form
          className="emp-filters"
          onSubmit={e => {
            e.preventDefault();
            setPage(1);
            setSearch(q);
          }}
        >
          <label className="field">
            <span>Tìm nhân viên</span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Tên hoặc mã nhân viên"
              maxLength={100}
            />
          </label>
          <label className="field">
            <span>Lọc trạng thái</span>
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {Object.entries(employmentLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary">
            Tìm kiếm
          </button>
        </form>

        {loading && <p role="status">Đang tải danh sách nhân viên…</p>}
        <div className="table-wrap" aria-busy={loading}>
          <table>
            <caption>Danh sách hồ sơ được phép xem</caption>
            <thead>
              <tr>
                <th>Mã nhân viên</th>
                <th>Họ và tên</th>
                <th>Phòng ban / vị trí</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {list?.items.map(e => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.employeeCode}</strong>
                  </td>
                  <td>
                    <strong>{e.fullName}</strong>
                    <small>{dateLabel(e.hireDate)}</small>
                  </td>
                  <td>
                    {e.departmentName || 'Chưa phân công'}
                    <small>{e.positionTitle || 'Chưa có vị trí'}</small>
                  </td>
                  <td>
                    <span className={`emp-badge emp-badge-${e.employmentStatus.toLowerCase()}`}>
                      {employmentLabels[e.employmentStatus]}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary"
                      aria-label={'Xem hồ sơ ' + e.fullName}
                      onClick={() => setSelected(e.id)}
                    >
                      Xem hồ sơ
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !error && list?.items.length === 0 && (
                <tr>
                  <td colSpan={5}>Chưa có hồ sơ phù hợp.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {list && pagination(page, list.total, setPage)}
      </section>

      {selected && (
        <EmployeeDetailDrawer
          key={selected + ':' + revision}
          id={selected}
          profile={profile}
          onClose={() => setSelected('')}
          onSaved={() => setRevision(n => n + 1)}
        />
      )}
    </div>
  );
}
